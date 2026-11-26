import { Input, Select } from "../components/ui";
import { FormEvent, MouseEvent, useState } from "react";
import { CircleCheck, Eye, EyeOff, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "../components/ui/button";
import { SetupPayload, SetupStatus } from "../lib/api";
import { Notice } from "../types";
import { AuthAtmosphere } from "../components/layout/AuthAtmosphere";

type SetupField = {
  key: string;
  label: string;
  type: "email" | "number" | "password" | "select" | "text";
  group: string;
  placeholder: string;
  optional?: boolean;
  maxLength?: number;
};

const setupFields: SetupField[] = [
  {
    key: "PORT",
    label: "服务端端口",
    type: "number",
    group: "基础配置",
    placeholder: "3000",
  },
  {
    key: "DB_HOST",
    label: "数据库地址",
    type: "text",
    group: "数据库",
    placeholder: "127.0.0.1",
  },
  {
    key: "DB_PORT",
    label: "数据库端口",
    type: "number",
    group: "数据库",
    placeholder: "3306",
  },
  {
    key: "DB_USER",
    label: "数据库用户",
    type: "text",
    group: "数据库",
    placeholder: "after_life",
  },
  {
    key: "DB_PASSWORD",
    label: "数据库密码",
    type: "password",
    group: "数据库",
    placeholder: "请输入数据库密码",
  },
  {
    key: "DB_NAME",
    label: "数据库名称",
    type: "text",
    group: "数据库",
    placeholder: "after_life",
  },
  {
    key: "MAIL_HOST",
    label: "邮件服务器",
    type: "text",
    group: "邮件",
    placeholder: "smtp.example.com",
    optional: true,
  },
  {
    key: "MAIL_PORT",
    label: "邮件端口",
    type: "number",
    group: "邮件",
    placeholder: "465",
    optional: true,
  },
  {
    key: "MAIL_USER",
    label: "邮件账号",
    type: "email",
    group: "邮件",
    placeholder: "mailer@example.com",
    optional: true,
    maxLength: 50,
  },
  {
    key: "MAIL_PASSWORD",
    label: "邮件密码",
    type: "password",
    group: "邮件",
    placeholder: "请输入邮件密码",
    optional: true,
  },
  {
    key: "MAIL_FROM",
    label: "发件人显示",
    type: "text",
    group: "邮件",
    placeholder: "After Life <mailer@example.com>",
    optional: true,
  },
  {
    key: "MAIL_SECURE",
    label: "SSL/TLS",
    type: "select",
    group: "邮件",
    placeholder: "关闭",
    optional: true,
  },
  {
    key: "INIT_ADMIN_USERNAME",
    label: "管理员名称",
    type: "text",
    group: "管理员",
    placeholder: "系统管理员",
    maxLength: 50,
  },
  {
    key: "INIT_ADMIN_EMAIL",
    label: "管理员邮箱",
    type: "email",
    group: "管理员",
    placeholder: "admin@example.com",
    maxLength: 50,
  },
  {
    key: "INIT_ADMIN_PASSWORD",
    label: "管理员密码",
    type: "password",
    group: "管理员",
    placeholder: "请输入 8 至 128 位新密码",
    maxLength: 128,
  },
];

const setupSteps = [
  {
    name: "基础配置",
    description: "确认 API 服务对外提供访问的端口。",
  },
  {
    name: "数据库",
    description: "连接 MySQL，并在提交前验证数据库是否可用。",
  },
  {
    name: "邮件",
    description: "邮件服务可以跳过，部署完成后再由管理员补充。",
  },
  {
    name: "管理员",
    description: "管理员账号用于系统维护、用户管理和权限配置。",
  },
  {
    name: "日常账户",
    description: "创建部署后的普通用户账号，用它登录并管理自己的信件与联系人。",
  },
] as const;

const groups = setupSteps.map((step) => step.name);

type InitialUserDraft = SetupPayload["initialUser"] & {
  passwordConfirmation: string;
};

type FieldErrors = Record<string, string>;

export function SetupScreen(props: {
  loading: boolean;
  notice: Notice;
  setupComplete: boolean;
  status: SetupStatus;
  onCheckDatabase: (payload: SetupPayload) => Promise<void>;
  onSave: (payload: SetupPayload) => Promise<void>;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepDirection, setStepDirection] = useState<"none" | "forward" | "backward">("none");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      setupFields.map((field) => [field.key, props.status.values?.[field.key] || ""]),
    ),
  );
  const [initialUser, setInitialUser] = useState<InitialUserDraft>({
    username: "",
    email: "",
    password: "",
    passwordConfirmation: "",
  });
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [resetDatabase, setResetDatabase] = useState(false);
  const currentGroup = groups[currentStep];
  const currentStepDetails = setupSteps[currentStep];
  const currentFields = setupFields.filter((field) => field.group === currentGroup);
  const initializationInProgress = props.status.initializing && !props.setupComplete;
  const waitingForRestart =
    props.setupComplete || props.status.requiresRestart || props.status.initializing;
  const visibleNotice =
    props.notice?.tone === "success" &&
    props.notice.text === "数据库连接测试通过。" &&
    currentGroup !== "数据库"
      ? null
      : props.notice;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === groups.length - 1;
  const canReuseDatabasePassword =
    props.status.databasePasswordConfigured === true &&
    ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"].every(
      (key) => values[key]?.trim() === props.status.values?.[key]?.trim(),
    );

  function isFieldRequired(key: string): boolean {
    if (
      key === "DB_PASSWORD" &&
      props.status.databasePasswordConfigured &&
      !canReuseDatabasePassword
    )
      return true;
    return key === "INIT_ADMIN_PASSWORD" || (props.status.missingKeys?.includes(key) ?? false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLastStep) {
      moveToStep(currentStep + 1);
      return;
    }

    const firstInvalidStep = findFirstInvalidStep(0, groups.length);
    if (firstInvalidStep >= 0) return;

    if (
      resetDatabase &&
      !window.confirm(
        "你已选择重置数据库。现有数据库将被删除并重建，此操作不可撤销。确定继续初始化吗？",
      )
    ) {
      selectStep(groups.indexOf("数据库"));
      return;
    }

    try {
      await props.onSave(createPayload());
      setInitialUser((current) => ({
        ...current,
        password: "",
        passwordConfirmation: "",
      }));
    } catch {
      // App owns the API error notice; keep the completed form available for correction.
    }
  }

  function createPayload(): SetupPayload {
    return {
      ...Object.fromEntries(setupFields.map((field) => [field.key, values[field.key] || ""])),
      resetDatabase,
      initialUser: {
        username: initialUser.username,
        email: initialUser.email,
        password: initialUser.password,
      },
    };
  }

  function getStepErrors(stepIndex: number): FieldErrors {
    const group = groups[stepIndex];
    if (group === "日常账户") return getInitialUserErrors();

    return setupFields
      .filter((field) => field.group === group)
      .reduce<FieldErrors>((errors, field) => {
        const value = values[field.key] || "";
        const normalizedValue = value.trim();
        const isRequired = isFieldRequired(field.key);

        if (isRequired && !normalizedValue) {
          errors[field.key] = `请输入${field.label}。`;
          return errors;
        }

        if (
          field.key === "INIT_ADMIN_PASSWORD" &&
          (value.length < 8 || value.length > 128 || normalizedValue === "admin123456")
        ) {
          errors[field.key] = "请输入 8 至 128 位新密码，不可使用原默认密码。";
          return errors;
        }
        if (!normalizedValue) return errors;

        if (field.type === "number" && !isValidPort(normalizedValue)) {
          errors[field.key] = "请输入 1 至 65535 之间的端口。";
        } else if (field.type === "email" && !isValidEmail(normalizedValue)) {
          errors[field.key] = "请输入有效的邮箱地址。";
        } else if (field.maxLength && normalizedValue.length > field.maxLength) {
          errors[field.key] = `最多输入 ${field.maxLength} 个字符。`;
        }

        return errors;
      }, {});
  }

  function getInitialUserErrors(): FieldErrors {
    const errors: FieldErrors = {};
    const username = initialUser.username.trim();
    const email = initialUser.email.trim();
    const adminEmail = (values.INIT_ADMIN_EMAIL || "").trim();

    if (!username) {
      errors["initialUser.username"] = "请输入日常使用的账户名称。";
    } else if (username.length > 50) {
      errors["initialUser.username"] = "账户名称最多输入 50 个字符。";
    }

    if (!email) {
      errors["initialUser.email"] = "请输入日常账户邮箱。";
    } else if (!isValidEmail(email)) {
      errors["initialUser.email"] = "请输入有效的邮箱地址。";
    } else if (email.length > 50) {
      errors["initialUser.email"] = "邮箱最多输入 50 个字符。";
    } else if (adminEmail && email.toLowerCase() === adminEmail.toLowerCase()) {
      errors["initialUser.email"] = "日常账户邮箱不能与管理员邮箱相同。";
    }

    if (!initialUser.password.trim()) {
      errors["initialUser.password"] = "请设置日常账户密码。";
    } else if (initialUser.password.length < 8) {
      errors["initialUser.password"] = "密码至少需要 8 个字符。";
    } else if (initialUser.password.length > 128) {
      errors["initialUser.password"] = "密码最多输入 128 个字符。";
    }

    if (!initialUser.passwordConfirmation) {
      errors["initialUser.passwordConfirmation"] = "请再次输入密码。";
    } else if (initialUser.passwordConfirmation !== initialUser.password) {
      errors["initialUser.passwordConfirmation"] = "两次输入的密码不一致。";
    }

    return errors;
  }

  function findFirstInvalidStep(start: number, end: number) {
    for (let stepIndex = start; stepIndex < end; stepIndex += 1) {
      const errors = getStepErrors(stepIndex);
      if (Object.keys(errors).length) {
        showErrors(stepIndex, errors);
        return stepIndex;
      }
    }

    setFieldErrors({});
    return -1;
  }

  function showErrors(stepIndex: number, errors: FieldErrors) {
    selectStep(stepIndex);
    setFieldErrors(errors);
    const firstErrorKey = Object.keys(errors)[0];
    window.requestAnimationFrame(() => {
      document.getElementById(getFieldId(firstErrorKey))?.focus();
    });
  }

  function moveToStep(nextStep: number) {
    if (nextStep <= currentStep) {
      setFieldErrors({});
      selectStep(nextStep);
      return;
    }

    if (findFirstInvalidStep(currentStep, nextStep) >= 0) return;
    selectStep(nextStep);
  }

  function selectStep(stepIndex: number): void {
    const nextStep = Math.max(0, Math.min(stepIndex, groups.length - 1));
    if (nextStep === currentStep) return;
    setStepDirection(nextStep > currentStep ? "forward" : "backward");
    setCurrentStep(nextStep);
  }

  function updateValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    clearFieldErrors(key);
  }

  function updateInitialUser(key: keyof InitialUserDraft, value: string) {
    setInitialUser((current) => ({ ...current, [key]: value }));
    clearFieldErrors(
      `initialUser.${key}`,
      key === "password" ? ["initialUser.passwordConfirmation"] : [],
    );
  }

  function clearFieldErrors(key: string, relatedKeys: string[] = []) {
    setFieldErrors((current) => {
      if (!current[key] && !relatedKeys.some((relatedKey) => current[relatedKey])) return current;
      const next = { ...current };
      delete next[key];
      relatedKeys.forEach((relatedKey) => delete next[relatedKey]);
      return next;
    });
  }

  async function handleDatabaseCheck(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const databaseStepIndex = groups.indexOf("数据库");
    if (findFirstInvalidStep(0, databaseStepIndex + 1) >= 0) return;

    try {
      await props.onCheckDatabase(createPayload());
    } catch {
      // App owns the API error notice.
    }
  }

  function togglePassword(key: string) {
    setVisiblePasswords((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <main className="setup-shell auth-ambient">
      <form
        className="setup-card panel"
        aria-busy={props.loading || waitingForRestart}
        noValidate
        onSubmit={handleSubmit}
      >
        <header className="setup-header">
          <div>
            <p className="setup-kicker">After Life Console</p>
            <h1>
              {initializationInProgress
                ? "正在创建日常账户"
                : waitingForRestart
                  ? "正在应用部署配置"
                  : "部署初始化向导"}
            </h1>
            <p className="muted">
              {waitingForRestart
                ? "服务恢复后会自动进入登录页，你无需刷新页面。"
                : "完成服务、数据库和账号设置。日常使用请登录普通用户账号。"}
            </p>
          </div>
          <span className="setup-count">
            {initializationInProgress
              ? "正在初始化"
              : waitingForRestart
                ? "配置已提交"
                : `第 ${currentStep + 1} 步，共 ${groups.length} 步`}
          </span>
        </header>

        {waitingForRestart ? (
          <>
            <section className="setup-completion" role="status" aria-live="polite">
              <span
                className={`setup-completion-icon${initializationInProgress ? " is-loading" : ""}`}
                aria-hidden="true"
              >
                {initializationInProgress ? (
                  <LoaderCircle size={28} strokeWidth={1.9} />
                ) : (
                  <CircleCheck size={28} strokeWidth={1.9} />
                )}
              </span>
              <div>
                <h2>{initializationInProgress ? "正在完成初始化" : "初始化已完成"}</h2>
                <p>
                  {initializationInProgress
                    ? "系统正在准备数据库并创建日常账户，请勿关闭此页面或重复提交。"
                    : "配置与日常账户已经提交。服务正在重新加载，稍后请使用刚创建的日常账户登录。"}
                </p>
                <span className="setup-restart-status">
                  <LoaderCircle aria-hidden="true" size={16} />
                  {initializationInProgress ? "正在创建日常账户" : "正在检测服务状态"}
                </span>
              </div>
            </section>
            {visibleNotice ? <SetupNotice notice={visibleNotice} /> : null}
          </>
        ) : (
          <>
            <nav className="setup-steps" aria-label="初始化步骤">
              {setupSteps.map((step, index) => (
                <button
                  className={[
                    index === currentStep ? "active" : "",
                    index < currentStep ? "complete" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={index === currentStep ? "step" : undefined}
                  disabled={props.loading}
                  key={step.name}
                  type="button"
                  onClick={() => moveToStep(index)}
                >
                  <span aria-hidden="true">{index + 1}</span>
                  {step.name}
                </button>
              ))}
            </nav>

            <div className="setup-step-content" data-direction={stepDirection} key={currentGroup}>
              <fieldset className="setup-group" disabled={props.loading}>
                <legend>{currentGroup}</legend>
                <div className="setup-group-body">
                  {currentGroup === "管理员" || currentGroup === "日常账户" ? (
                    <div
                      className={`setup-role-note${currentGroup === "日常账户" ? " is-primary" : ""}`}
                    >
                      <span className="setup-role-icon" aria-hidden="true">
                        {currentGroup === "管理员" ? (
                          <ShieldCheck size={20} />
                        ) : (
                          <UserRound size={20} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {currentGroup === "管理员" ? "维护专用账号" : "部署后的日常登录账号"}
                        </strong>
                        <p>{currentStepDetails.description}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="setup-group-description">{currentStepDetails.description}</p>
                  )}

                  {currentGroup === "日常账户" ? (
                    <InitialUserFields
                      disabled={props.loading}
                      errors={fieldErrors}
                      user={initialUser}
                      visiblePasswords={visiblePasswords}
                      onChange={updateInitialUser}
                      onTogglePassword={togglePassword}
                    />
                  ) : (
                    <div className="setup-grid">
                      {currentFields.map((field) => {
                        const isMissing = isFieldRequired(field.key);
                        const value = values[field.key] || "";
                        const error = fieldErrors[field.key];
                        const fieldId = getFieldId(field.key);
                        const errorId = `${fieldId}-error`;
                        const sharedProps = {
                          id: fieldId,
                          name: field.key,
                          value,
                          required: isMissing,
                          "aria-invalid": Boolean(error),
                          "aria-describedby": error ? errorId : undefined,
                        };

                        return (
                          <div className="setup-field" key={field.key}>
                            <label htmlFor={fieldId}>
                              <span className="setup-field-label">
                                {field.label}
                                {isMissing ? <em>必填</em> : null}
                                {field.optional && !isMissing ? <em>可跳过</em> : null}
                              </span>
                            </label>
                            {field.type === "select" ? (
                              <Select
                                {...sharedProps}
                                ariaLabel={field.label}
                                disabled={props.loading}
                                value={value || "false"}
                                onValueChange={(value) => updateValue(field.key, value)}
                                options={[
                                  { value: "false", label: "关闭" },
                                  { value: "true", label: "开启" },
                                ]}
                              />
                            ) : field.type === "password" ? (
                              <PasswordControl
                                {...sharedProps}
                                autoComplete="new-password"
                                placeholder={
                                  field.key === "DB_PASSWORD" && canReuseDatabasePassword
                                    ? "已配置，留空使用现有密码"
                                    : field.placeholder
                                }
                                visible={Boolean(visiblePasswords[field.key])}
                                onChange={(value) => updateValue(field.key, value)}
                                onToggle={() => togglePassword(field.key)}
                              />
                            ) : (
                              <Input
                                {...sharedProps}
                                autoCapitalize={field.type === "email" ? "none" : undefined}
                                autoComplete="off"
                                inputMode={field.type === "number" ? "numeric" : undefined}
                                max={field.type === "number" ? 65535 : undefined}
                                maxLength={field.maxLength}
                                min={field.type === "number" ? 1 : undefined}
                                placeholder={field.placeholder}
                                spellCheck={field.type === "email" ? false : undefined}
                                type={field.type}
                                onChange={(event) => updateValue(field.key, event.target.value)}
                              />
                            )}
                            {error ? (
                              <small className="setup-field-error" id={errorId} role="alert">
                                {error}
                              </small>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </fieldset>

              {currentGroup === "数据库" ? (
                <label className="setup-reset-option">
                  <Input
                    name="resetDatabase"
                    type="checkbox"
                    checked={resetDatabase}
                    disabled={props.loading}
                    onChange={(event) => setResetDatabase(event.target.checked)}
                  />
                  <span>
                    <strong>危险操作：重置数据库</strong>
                    <small>删除并重建当前数据库，然后重新执行迁移和初始化。此操作不可撤销。</small>
                  </span>
                </label>
              ) : null}

              {visibleNotice ? <SetupNotice notice={visibleNotice} /> : null}
            </div>

            <div className="setup-actions">
              {currentGroup === "数据库" ? (
                <Button
                  variant="secondary"
                  disabled={props.loading}
                  type="button"
                  onClick={handleDatabaseCheck}
                >
                  {props.loading ? "正在测试..." : "测试连接"}
                </Button>
              ) : null}
              <Button
                variant="outline"
                disabled={props.loading || isFirstStep}
                type="button"
                onClick={() => moveToStep(currentStep - 1)}
              >
                上一步
              </Button>
              {!isLastStep ? (
                <Button
                  key="next"
                  variant="default"
                  disabled={props.loading}
                  type="button"
                  onClick={() => moveToStep(currentStep + 1)}
                >
                  下一步
                </Button>
              ) : (
                <Button key="finish" variant="default" disabled={props.loading} type="submit">
                  {props.loading ? "正在创建账户..." : "完成初始化"}
                </Button>
              )}
            </div>
          </>
        )}
      </form>
      <AuthAtmosphere />
    </main>
  );
}

function InitialUserFields(props: {
  disabled: boolean;
  errors: FieldErrors;
  user: InitialUserDraft;
  visiblePasswords: Record<string, boolean>;
  onChange: (key: keyof InitialUserDraft, value: string) => void;
  onTogglePassword: (key: string) => void;
}) {
  const fields: Array<{
    key: keyof InitialUserDraft;
    label: string;
    type: "email" | "password" | "text";
    placeholder: string;
    autoComplete: string;
  }> = [
    {
      key: "username",
      label: "账户名称",
      type: "text",
      placeholder: "你的称呼",
      autoComplete: "username",
    },
    {
      key: "email",
      label: "登录邮箱",
      type: "email",
      placeholder: "you@example.com",
      autoComplete: "email",
    },
    {
      key: "password",
      label: "登录密码",
      type: "password",
      placeholder: "至少 8 个字符",
      autoComplete: "new-password",
    },
    {
      key: "passwordConfirmation",
      label: "确认密码",
      type: "password",
      placeholder: "再次输入密码",
      autoComplete: "new-password",
    },
  ];

  return (
    <div className="setup-grid setup-account-grid">
      {fields.map((field) => {
        const errorKey = `initialUser.${field.key}`;
        const error = props.errors[errorKey];
        const fieldId = getFieldId(errorKey);
        const errorId = `${fieldId}-error`;
        const hintId = field.key === "password" ? `${fieldId}-hint` : undefined;
        const describedBy = [error ? errorId : "", hintId || ""].filter(Boolean).join(" ");
        const sharedProps = {
          id: fieldId,
          name: errorKey,
          value: props.user[field.key],
          required: true,
          disabled: props.disabled,
          "aria-invalid": Boolean(error),
          "aria-describedby": describedBy || undefined,
        };

        return (
          <div className="setup-field" key={field.key}>
            <label htmlFor={fieldId}>
              <span className="setup-field-label">
                {field.label}
                <em>必填</em>
              </span>
            </label>
            {field.type === "password" ? (
              <PasswordControl
                {...sharedProps}
                autoComplete={field.autoComplete}
                maxLength={128}
                placeholder={field.placeholder}
                visible={Boolean(props.visiblePasswords[errorKey])}
                onChange={(value) => props.onChange(field.key, value)}
                onToggle={() => props.onTogglePassword(errorKey)}
              />
            ) : (
              <Input
                {...sharedProps}
                autoCapitalize={field.type === "email" ? "none" : undefined}
                autoComplete={field.autoComplete}
                maxLength={50}
                minLength={field.key === "username" ? 1 : undefined}
                placeholder={field.placeholder}
                spellCheck={field.type === "email" ? false : undefined}
                type={field.type}
                onChange={(event) => props.onChange(field.key, event.target.value)}
              />
            )}
            {hintId ? (
              <small className="setup-field-hint" id={hintId}>
                至少 8 个字符，建议混合使用字母、数字和符号。
              </small>
            ) : null}
            {error ? (
              <small className="setup-field-error" id={errorId} role="alert">
                {error}
              </small>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PasswordControl(props: {
  id: string;
  name: string;
  value: string;
  visible: boolean;
  placeholder: string;
  autoComplete: string;
  required: boolean;
  disabled?: boolean;
  maxLength?: number;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  return (
    <div className="password-control">
      <Input
        id={props.id}
        name={props.name}
        type={props.visible ? "text" : "password"}
        value={props.value}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        required={props.required}
        disabled={props.disabled}
        maxLength={props.maxLength}
        aria-invalid={props["aria-invalid"]}
        aria-describedby={props["aria-describedby"]}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={props.visible ? "隐藏密码" : "显示密码"}
        aria-pressed={props.visible}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        {props.visible ? (
          <EyeOff aria-hidden="true" size={17} />
        ) : (
          <Eye aria-hidden="true" size={17} />
        )}
      </button>
    </div>
  );
}

function SetupNotice(props: { notice: NonNullable<Notice> }) {
  return (
    <div
      className={`notice notice-${props.notice.tone}`}
      role={props.notice.tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {props.notice.text}
    </div>
  );
}

function getFieldId(key: string) {
  return `setup-${key.replace(/\./g, "-").toLowerCase()}`;
}

function isValidPort(value: string) {
  if (!/^\d+$/.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
