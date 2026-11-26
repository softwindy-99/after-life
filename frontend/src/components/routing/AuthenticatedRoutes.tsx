import { usePersonalLayout } from "../../hooks/usePersonalLayout";
import { AdministrationScreen } from "../../pages/AdministrationScreen";
import { McpSettingsRoute } from "./McpSettingsRoute";
import type { Administration } from "../../hooks/useAdministration";
import { Navigate, Route, Routes } from "react-router-dom";
import type { CheckInStatus, DashboardData, NotificationPreferences } from "../../lib/api";
import type { BrowserPushStatus } from "../../lib/push";
import type { ContactDraft, LetterDraft, NotificationAction } from "../../types";
import { ContactsScreen } from "../../pages/ContactsScreen";
import { MailScreen } from "../../pages/MailScreen";
import { OverviewScreen } from "../../pages/OverviewScreen";
import { ProfileScreen } from "../../pages/ProfileScreen";
import { RolesScreen } from "../../pages/RolesScreen";
import { UsersScreen } from "../../pages/UsersScreen";
import { CheckInScreen } from "../../pages/CheckInScreen";
import { SystemSettingsScreen } from "../../pages/SystemSettingsScreen";
import { lazy, Suspense } from "react";
import { Spinner } from "../ui";

const UIKitScreen = lazy(() =>
  import("../../pages/UIKitScreen").then((module) => ({ default: module.UIKitScreen })),
);
const LettersScreen = lazy(() =>
  import("../../pages/LettersScreen").then((module) => ({ default: module.LettersScreen })),
);

interface AuthenticatedRoutesProps {
  sessionKey: string;
  administration: Administration;
  dashboard: DashboardData;
  checkInStatus: CheckInStatus | null;
  pushStatus: BrowserPushStatus;
  profileAvatar: string | null;
  loading: boolean;
  notificationAction: NotificationAction | null;
  isAdmin: boolean;
  onProfileSave: (payload: {
    username: string;
    email: string;
    password?: string;
    avatar?: string | null;
  }) => Promise<void>;
  onCheckIn: () => Promise<void>;
  onEnableNotifications: (preferences: NotificationPreferences) => Promise<void>;
  onSaveNotificationPreferences: (preferences: NotificationPreferences) => Promise<void>;
  onDisableNotifications: () => Promise<void>;
  onLetterCreate: (payload: LetterDraft) => Promise<void>;
  onLetterUpdate: (uuid: string, payload: LetterDraft) => Promise<void>;
  onLetterRemove: (uuid: string) => Promise<void>;
  onContactCreate: (payload: ContactDraft) => Promise<void>;
  onContactUpdate: (uuid: string, payload: ContactDraft) => Promise<void>;
  onContactRemove: (uuid: string) => Promise<void>;
}

export function AuthenticatedRoutes(props: AuthenticatedRoutesProps) {
  const personalLayout = usePersonalLayout();
  return (
    <Suspense fallback={<Spinner label="正在载入页面" />}>
      <Routes>
        <Route
          path="/ui-kit"
          element={
            <Suspense fallback={<Spinner label="正在载入设计系统" />}>
              <UIKitScreen />
            </Suspense>
          }
        />
        <Route
          path="/"
          element={
            <OverviewScreen
              dashboard={props.dashboard}
              adminDashboard={personalLayout ? null : props.administration.adminDashboard}
            />
          }
        />
        <Route
          path="/admin"
          element={
            props.isAdmin ? (
              <AdministrationScreen
                dashboard={props.dashboard}
                adminDashboard={props.administration.adminDashboard}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/checkin"
          element={
            <CheckInScreen
              dashboard={props.dashboard}
              status={props.checkInStatus}
              pushStatus={props.pushStatus}
              loading={props.loading}
              notificationAction={props.notificationAction}
              onCheckIn={props.onCheckIn}
              onEnableNotifications={props.onEnableNotifications}
              onSaveNotificationPreferences={props.onSaveNotificationPreferences}
              onDisableNotifications={props.onDisableNotifications}
            />
          }
        />
        <Route
          path="/letters"
          element={
            <LettersScreen
              key={props.sessionKey}
              ownerUuid={props.dashboard.user!.uuid}
              letters={props.dashboard.letters}
              contacts={props.dashboard.contacts}
              loading={props.loading}
              onCreate={props.onLetterCreate}
              onUpdate={props.onLetterUpdate}
              onRemove={props.onLetterRemove}
            />
          }
        />
        <Route
          path="/contacts"
          element={
            <ContactsScreen
              contacts={props.dashboard.contacts}
              letters={props.dashboard.letters}
              loading={props.loading}
              onCreate={props.onContactCreate}
              onUpdate={props.onContactUpdate}
              onRemove={props.onContactRemove}
            />
          }
        />
        <Route
          path="/mail"
          element={
            props.isAdmin ? (
              <MailScreen
                config={props.administration.mailConfig}
                loading={props.loading}
                onRefresh={props.administration.onMailRefresh}
                onSave={props.administration.onMailSave}
                onVerify={props.administration.onMailVerify}
                onTest={props.administration.onTestMail}
                onNotify={props.administration.onNotifyMail}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/settings"
          element={
            props.isAdmin ? (
              <SystemSettingsScreen
                key={props.sessionKey}
                settings={props.administration.systemSettings}
                loading={props.loading}
                onRefresh={props.administration.onSystemSettingsRefresh}
                onSave={props.administration.onSystemSettingsSave}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/users"
          element={
            props.isAdmin ? (
              <UsersScreen
                loading={props.loading}
                usersPage={props.administration.usersPage}
                roles={props.administration.roles}
                query={props.administration.userQuery}
                onQueryChange={props.administration.onUserQueryChange}
                onFetchAvatar={props.administration.onFetchUserAvatar}
                onCreate={props.administration.onAdminUserCreate}
                onSave={props.administration.onAdminUserSave}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/roles"
          element={
            props.isAdmin ? (
              <RolesScreen
                roles={props.administration.roles}
                permissions={props.administration.permissions}
                loading={props.loading}
                onSave={props.administration.onRolePermissionSave}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/profile"
          element={
            <ProfileScreen
              loading={props.loading}
              user={props.dashboard.user}
              avatar={props.profileAvatar}
              onSave={props.onProfileSave}
            />
          }
        />
        <Route
          path="/mcp-settings"
          element={<McpSettingsRoute key={props.sessionKey} letters={props.dashboard.letters} />}
        />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
