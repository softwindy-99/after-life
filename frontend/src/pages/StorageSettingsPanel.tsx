import { useEffect, useState } from "react";
import { Button, Input, Select } from "../components/ui";
import type { StorageDraft, StorageStatus } from "../lib/api-types";
import type { useStorageSettings } from "../hooks/useStorageSettings";

function editable(settings: StorageStatus | null): StorageDraft {
  return {
    driver: settings?.driver || "local",
    endpoint: settings?.endpoint || "",
    region: settings?.region || "",
    bucket: settings?.bucket || "",
    prefix: settings?.prefix ?? "after-life",
    forcePathStyle: settings?.forcePathStyle ?? true,
    accessKeyId: "",
    accessKeySecret: "",
  };
}

export function StorageSettingsPanel(props: ReturnType<typeof useStorageSettings>) {
  const [draft, setDraft] = useState<StorageDraft>(() => editable(props.settings));
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    setDraft(editable(props.settings));
    setChanged(false);
  }, [props.settings]);
  function change(next: Partial<StorageDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setChanged(true);
  }
  const disabled = props.busy || !props.settings;
  return (
    <form
      className="panel form-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void props.save(draft);
      }}
    >
      <div className="panel-head">
        <div>
          <p className="eyebrow">Object storage</p>
          <h3>对象存储</h3>
        </div>
        <span>{props.settings?.driver === "local" ? "本地磁盘" : "外部存储"}</span>
      </div>
      <p className="muted">
        支持 MinIO 等 S3 兼容服务和阿里云 OSS。请使用私有桶，文件仍通过本站受控链接访问。
      </p>
      <fieldset disabled={disabled} className="form-grid storage-fields">
        <label>
          存储服务
          <Select
            ariaLabel="存储服务"
            value={draft.driver}
            disabled={disabled}
            options={[
              { value: "local", label: "本地磁盘" },
              { value: "s3", label: "S3 兼容（MinIO / Amazon S3）" },
              { value: "oss", label: "阿里云 OSS" },
            ]}
            onValueChange={(value) => change({ driver: value as StorageDraft["driver"] })}
          />
        </label>
        {draft.driver !== "local" ? (
          <>
            <label>
              Endpoint
              <Input
                value={draft.endpoint}
                placeholder={
                  draft.driver === "oss"
                    ? "https://oss-cn-hangzhou.aliyuncs.com"
                    : "https://minio.example.com"
                }
                required
                onChange={(event) => change({ endpoint: event.target.value })}
              />
            </label>
            <label>
              区域 Region
              <Input
                value={draft.region}
                placeholder={draft.driver === "oss" ? "cn-hangzhou" : "us-east-1"}
                required
                onChange={(event) => change({ region: event.target.value })}
              />
            </label>
            <label>
              Bucket
              <Input
                value={draft.bucket}
                required
                onChange={(event) => change({ bucket: event.target.value })}
              />
            </label>
            <label>
              对象前缀
              <Input
                value={draft.prefix}
                onChange={(event) => change({ prefix: event.target.value })}
              />
            </label>
            <label>
              Access Key ID
              <Input
                type="password"
                autoComplete="new-password"
                value={draft.accessKeyId}
                placeholder={
                  props.settings?.credentialsConfigured ? "已配置，留空保留" : "输入访问密钥 ID"
                }
                onChange={(event) => change({ accessKeyId: event.target.value })}
              />
            </label>
            <label>
              Access Key Secret
              <Input
                type="password"
                autoComplete="new-password"
                value={draft.accessKeySecret}
                placeholder={
                  props.settings?.credentialsConfigured ? "已配置，留空保留" : "输入访问密钥"
                }
                onChange={(event) => change({ accessKeySecret: event.target.value })}
              />
            </label>
            {draft.driver === "s3" ? (
              <label>
                寻址方式
                <Select
                  ariaLabel="寻址方式"
                  value={String(draft.forcePathStyle)}
                  disabled={disabled}
                  options={[
                    { value: "true", label: "路径模式（MinIO 常用）" },
                    { value: "false", label: "虚拟主机模式（Amazon S3 常用）" },
                  ]}
                  onValueChange={(value) => change({ forcePathStyle: value === "true" })}
                />
              </label>
            ) : null}
          </>
        ) : null}
      </fieldset>
      <p className="muted">
        本地文件 {props.settings?.localCount ?? "—"} 个，外部文件{" "}
        {props.settings?.externalCount ?? "—"} 个。
        保存配置后可迁移已有本地文件；迁移会校验内容并保留本地原件，失败后可重试。
        已有外部文件时只能更新凭据，不能更换服务、区域、桶或前缀。
      </p>
      {props.settings && !props.settings.writable ? (
        <p className="notice">当前使用进程环境配置，请在部署环境中修改存储设置。</p>
      ) : null}
      {props.message ? (
        <p role="status" className="notice notice-success">
          {props.message}
        </p>
      ) : null}
      {props.error ? (
        <p role="alert" className="notice notice-error">
          {props.error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button type="submit" disabled={disabled || !changed || !props.settings?.writable}>
          保存存储配置
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || draft.driver === "local"}
          onClick={() => void props.test(draft)}
        >
          测试连接
        </Button>
        <Button
          type="button"
          variant="outline"
          busy={props.busy}
          disabled={
            disabled || changed || props.settings?.driver === "local" || !props.settings?.localCount
          }
          onClick={() => void props.migrate()}
        >
          迁移本地文件
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={props.busy}
          onClick={() => void props.refresh()}
        >
          刷新存储状态
        </Button>
      </div>
    </form>
  );
}
