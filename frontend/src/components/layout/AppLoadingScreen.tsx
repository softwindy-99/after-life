import { Progress, Spinner } from "../ui";
import { TerminalBrand } from "./TerminalBrand";

export function AppLoadingScreen({ message }: { message: string }) {
  return (
    <main className="session-loading-screen" aria-busy="true">
      <TerminalBrand />
      <section className="ui-panel session-loading-card" role="status" aria-live="polite">
        <div>
          <Spinner decorative />
          <h1>{message}</h1>
        </div>
        <Progress label={message} />
      </section>
    </main>
  );
}
