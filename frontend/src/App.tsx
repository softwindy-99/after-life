import { ReleaseNotice } from "./components/layout/ReleaseNotice";
import { useAdministration } from "./hooks/useAdministration";
import { useFeedback } from "./hooks/useFeedback";
import { useSetup } from "./hooks/useSetup";
import { useStartupSequence } from "./hooks/useStartupSequence";
import { useNotifications } from "./hooks/useNotifications";
import { readSetupLoginEmail, forgetSetupLoginEmail } from "./lib/setup-session";
import { useCallback, useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  ApiError,
  CheckInStatus,
  DashboardData,
  TOKEN_STORAGE_KEY,
  createCheckIn,
  createContact,
  createLetter,
  fetchContacts,
  fetchCheckInStatus,
  fetchDashboardData,
  fetchLetters,
  fetchProfile,
  fetchProfileAvatar,
  login,
  registerUser,
  removeContact,
  removeLetter,
  updateContact,
  updateLetter,
  updateProfile,
} from "./lib/api";
import { AppShell } from "./components/layout/AppShell";
import { AppLoadingScreen } from "./components/layout/AppLoadingScreen";
import { StartupScreen } from "./components/layout/StartupScreen";
import { AuthenticatedRoutes } from "./components/routing/AuthenticatedRoutes";
import { LoginScreen } from "./pages/LoginScreen";
import { SetupScreen } from "./pages/SetupScreen";
import { hasAdminAccess, normalizeNullable, resolveErrorMessage } from "./lib/format";
import { ContactDraft, LetterDraft } from "./types";
import { disconnectPushOnLogout } from "./lib/push";
import { usePushServiceWorker } from "./lib/service-worker";
import { clearLetterDrafts } from "./lib/letter-drafts";

function readStoredToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

function App() {
  usePushServiceWorker();
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const feedback = useFeedback();
  const {
    loading,
    notice,
    setNotice,
    dismissNotice,
    withFeedback,
    reset: resetFeedback,
  } = feedback;
  const notifications = useNotifications(token, setNotice);
  const { pushStatus, notificationAction, reset: resetNotifications } = notifications;
  const [bootstrapping, setBootstrapping] = useState(Boolean(readStoredToken()));
  const [dashboard, setDashboard] = useState<DashboardData>({
    user: null,
    letters: [],
    contacts: [],
  });
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus | null>(null);
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const isAdmin = hasAdminAccess(dashboard.user);
  const administration = useAdministration(isAdmin, token, feedback);
  const { resetAdminState, loadAdminState, reloadAdminDashboard } = administration;

  const applySession = useCallback(
    (nextToken: string | null) => {
      resetFeedback();
      setToken(nextToken);
      setBootstrapping(Boolean(nextToken));
      setDashboard({ user: null, letters: [], contacts: [] });
      setCheckInStatus(null);
      resetNotifications();
      setProfileAvatar(null);
      resetAdminState();
    },
    [resetAdminState, resetNotifications, resetFeedback],
  );

  const clearSession = useCallback(() => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    applySession(null);
  }, [applySession]);

  useEffect(() => {
    function syncSession(event: StorageEvent) {
      if (
        event.storageArea !== window.localStorage ||
        (event.key !== TOKEN_STORAGE_KEY && event.key !== null)
      )
        return;
      const nextToken = readStoredToken();
      if (nextToken !== token) applySession(nextToken);
    }
    window.addEventListener("storage", syncSession);
    return () => window.removeEventListener("storage", syncSession);
  }, [applySession, token]);

  const setup = useSetup(clearSession, feedback);
  const { setupStatus, setupComplete } = setup;
  const startup = useStartupSequence(setupStatus, setup.checking);
  const visibleSetupStatus = setupStatus ?? startup.cachedStatus;

  useEffect(() => {
    if (!setupStatus) return;
    if (setupStatus.needsSetup) {
      setBootstrapping(false);
      return;
    }

    if (!token) {
      setBootstrapping(false);
      return;
    }

    let active = true;

    async function bootstrap() {
      setBootstrapping(true);
      try {
        const [next, nextCheckInStatus, nextProfileAvatar] = await Promise.all([
          fetchDashboardData(),
          fetchCheckInStatus(),
          fetchProfileAvatar(),
        ]);
        if (!active) return;
        setDashboard(next);
        setCheckInStatus(nextCheckInStatus);
        setProfileAvatar(nextProfileAvatar.avatar);

        if (hasAdminAccess(next.user)) {
          await loadAdminState(() => active);
        } else if (active) {
          resetAdminState();
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && [401, 403].includes(error.statusCode)) {
          clearSession();
        }
        setNotice({
          tone: "error",
          text: resolveErrorMessage(error),
        });
      } finally {
        if (active) setBootstrapping(false);
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, [clearSession, loadAdminState, resetAdminState, setNotice, setupStatus, token]);

  function persistSession(nextToken: string) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
    applySession(nextToken);
  }

  async function reloadProfile() {
    const user = await fetchProfile();
    setDashboard((current) => ({ ...current, user }));
  }

  async function reloadProfileAvatar() {
    const next = await fetchProfileAvatar();
    setProfileAvatar(next.avatar);
  }

  async function refreshCorrespondence() {
    const [letters, contacts] = await Promise.allSettled([
      fetchLetters(),
      fetchContacts(),
      reloadAdminDashboard(),
    ]);
    if (readStoredToken() !== token) return;
    setDashboard((current) => ({
      ...current,
      letters: letters.status === "fulfilled" ? letters.value : current.letters,
      contacts: contacts.status === "fulfilled" ? contacts.value : current.contacts,
    }));
    // 已完成的写入不能因列表刷新失败被报告为失败，否则重试可能重复创建。
    // A failed refresh must not turn a committed write into a retryable create failure.
    if (letters.status === "rejected" || contacts.status === "rejected") {
      setNotice({ tone: "error", text: "操作已完成，但列表暂未完整刷新，请稍后刷新页面。" });
    }
  }

  async function handleLogin(email: string, password: string) {
    const nextToken = await withFeedback(
      () => login(email, password),
      "登录成功，你的数据已经同步。",
    );
    forgetSetupLoginEmail();
    persistSession(nextToken);
    navigate("/");
  }

  async function handleProfileSave(payload: {
    username: string;
    email: string;
    password?: string;
    avatar?: string | null;
  }) {
    await withFeedback(() => updateProfile(payload), "个人资料已更新。");
    await Promise.all([reloadProfile(), reloadProfileAvatar()]);
  }

  async function handleCheckIn() {
    const checkIn = await withFeedback(
      () => createCheckIn("pwa"),
      "签到成功，信件投递倒计时已重新开始。",
    );
    setCheckInStatus({
      lastSeenAt: checkIn.checkedAt,
      checkIn,
      baselineAt: checkIn.checkedAt,
      baselineSource: "check-in",
    });
  }

  async function handleLogout() {
    try {
      await disconnectPushOnLogout();
    } catch {
      // A stale server subscription is removed after the push service rejects it.
    }
    // 登录过期仍允许同一所有者重新认证后恢复，只有明确退出才清理私有草稿。
    // Expiry preserves recovery for reauthentication; explicit logout removes private drafts.
    clearLetterDrafts();
    clearSession();
    navigate("/login");
  }

  async function handleLetterCreate(payload: LetterDraft) {
    const saved = await withFeedback(() => createLetter(payload), "信件已创建。");
    if (readStoredToken() !== token) return;
    setDashboard((current) => ({ ...current, letters: [saved, ...current.letters] }));
    await refreshCorrespondence();
  }

  async function handleLetterUpdate(uuid: string, payload: LetterDraft) {
    const saved = await withFeedback(() => updateLetter(uuid, payload), "信件已保存。");
    if (readStoredToken() !== token) return;
    setDashboard((current) => ({
      ...current,
      letters: current.letters.map((letter) => (letter.uuid === uuid ? saved : letter)),
    }));
    await refreshCorrespondence();
  }

  async function handleLetterRemove(uuid: string) {
    await withFeedback(() => removeLetter(uuid), "信件已删除。");
    if (readStoredToken() !== token) return;
    setDashboard((current) => ({
      ...current,
      letters: current.letters.filter((letter) => letter.uuid !== uuid),
    }));
    await refreshCorrespondence();
  }

  async function handleContactCreate(payload: ContactDraft) {
    await withFeedback(
      () =>
        createContact({
          ...payload,
          email: normalizeNullable(payload.email),
          phone: normalizeNullable(payload.phone),
          note: normalizeNullable(payload.note),
        }),
      "联系人已创建。",
    );
    await refreshCorrespondence();
  }

  async function handleContactUpdate(uuid: string, payload: ContactDraft) {
    await withFeedback(
      () =>
        updateContact(uuid, {
          ...payload,
          email: normalizeNullable(payload.email),
          phone: normalizeNullable(payload.phone),
          note: normalizeNullable(payload.note),
        }),
      "联系人已保存。",
    );
    await refreshCorrespondence();
  }

  async function handleContactRemove(uuid: string) {
    await withFeedback(() => removeContact(uuid), "联系人已删除。");
    await refreshCorrespondence();
  }

  if (startup.showStartup) {
    return (
      <StartupScreen
        phase={startup.phase}
        checking={setup.checking}
        holdMode={startup.holdMode}
        held={startup.held}
        error={setupStatus ? "" : setup.connectionError}
        onRetry={setup.retryConnection}
        onSkip={startup.skip}
        onReplay={startup.replay}
        onContinue={startup.proceed}
      />
    );
  }

  if (
    visibleSetupStatus &&
    (visibleSetupStatus.needsSetup ||
      visibleSetupStatus.requiresRestart ||
      visibleSetupStatus.initializing ||
      setupComplete)
  ) {
    return (
      <SetupScreen
        key={setupStatus ? "live" : "cached"}
        loading={loading || setup.checking}
        notice={notice}
        setupComplete={setupComplete}
        status={visibleSetupStatus}
        onCheckDatabase={setup.checkDatabase}
        onSave={setup.save}
      />
    );
  }

  if (!token || !setupStatus) {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <LoginScreen
              initialEmail={readSetupLoginEmail()}
              loading={loading}
              checking={setup.checking}
              notice={notice}
              onLogin={handleLogin}
              onRegister={async (username, email, password) => {
                await withFeedback(
                  () => registerUser(username, email, password),
                  "账号已创建，请登录。",
                );
              }}
            />
          }
        />
      </Routes>
    );
  }

  if (bootstrapping) return <AppLoadingScreen message="正在同步你的数据空间" />;

  return (
    <AppShell
      pathname={location.pathname}
      username={dashboard.user?.username}
      isAdmin={isAdmin}
      notice={notice}
      onNoticeClose={dismissNotice}
      onLogout={() => void handleLogout()}
    >
      {isAdmin && <ReleaseNotice />}
      <AuthenticatedRoutes
        sessionKey={token}
        dashboard={dashboard}
        checkInStatus={checkInStatus}
        pushStatus={pushStatus}
        administration={administration}
        profileAvatar={profileAvatar}
        loading={loading}
        notificationAction={notificationAction}
        isAdmin={isAdmin}
        onProfileSave={handleProfileSave}
        onCheckIn={handleCheckIn}
        onEnableNotifications={notifications.enable}
        onSaveNotificationPreferences={notifications.savePreferences}
        onDisableNotifications={notifications.disable}
        onLetterCreate={handleLetterCreate}
        onLetterUpdate={handleLetterUpdate}
        onLetterRemove={handleLetterRemove}
        onContactCreate={handleContactCreate}
        onContactUpdate={handleContactUpdate}
        onContactRemove={handleContactRemove}
      />
    </AppShell>
  );
}

export default App;
