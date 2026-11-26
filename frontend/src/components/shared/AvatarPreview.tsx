export function AvatarPreview(props: { value?: string | null; label?: string }) {
  if (props.value) {
    return (
      <img className="avatar-preview" src={props.value} alt={`${props.label || "用户"}头像`} />
    );
  }

  return (
    <div className="avatar-preview avatar-placeholder" aria-label="暂无头像">
      {(props.label || "U").trim().slice(0, 1).toUpperCase()}
    </div>
  );
}
