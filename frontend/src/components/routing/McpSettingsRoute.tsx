import { useMcpSettings } from "../../hooks/useMcpSettings";
import { McpSettingsScreen } from "../../pages/McpSettingsScreen";
import type { LetterRecord } from "../../lib/api";

export function McpSettingsRoute(props: { letters: LetterRecord[] }) {
  const settings = useMcpSettings();
  return <McpSettingsScreen {...settings} letters={props.letters} />;
}
