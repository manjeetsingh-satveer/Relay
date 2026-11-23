import sealedbox from "tweetnacl-sealedbox-js";
import { RelayError } from "../core/errors.ts";

/**
 * The wake-up alarm: a private repository "relay-alarm" in the user's own GitHub account whose
 * scheduled GitHub Actions workflow starts the user's Codespace at each bot's time. It also
 * wakes the Codespace once a week, so GitHub never deletes it for being unused.
 * Docs: https://docs.github.com/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule
 */
export const ALARM_REPO = "relay-alarm";
const WORKFLOW_PATH = ".github/workflows/wake.yml";
/** Weekly wake-up (UTC) that keeps the Codespace from expiring. */
export const WEEKLY_CRON = "23 12 * * 3";

type Fetch = typeof fetch;

export function workflowYaml(codespaceName: string, crons: string[]): string {
  const all = [...crons, WEEKLY_CRON];
  return [
    "# Managed by Relay. Wakes your Relay Codespace for scheduled bots and once a week.",
    "# Edits here are replaced when you change a bot's schedule in Relay.",
    "name: Wake Relay",
    "on:",
    "  schedule:",
    ...all.map((cron) => `    - cron: "${cron}"`),
    "  workflow_dispatch:",
    "permissions: {}",
    "jobs:",
    "  wake:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 2",
    "    steps:",
    "      - name: Start the Codespace",
    "        env:",
    "          TOKEN: ${{ secrets.RELAY_TOKEN }}",
    `          CODESPACE: ${codespaceName}`,
    "        run: |",
    '          status=$(curl -s -o /tmp/out -w "%{http_code}" -X POST \\',
    '            -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \\',
    '            "https://api.github.com/user/codespaces/$CODESPACE/start")',
    '          echo "GitHub answered $status"; cat /tmp/out; echo',
    '          # 409 means it is already running.',
    '          if [ "$status" != "200" ] && [ "$status" != "202" ] && [ "$status" != "409" ]; then exit 1; fi',
    "",
  ].join("\n");
}

export class Alarm {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
    });
    const body = response.status === 204 ? {} : ((await response.json().catch(() => ({}))) as Record<string, unknown>);
    return { status: response.status, body };
  }

  private async ok(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const result = await this.call(path, init);
    if (result.status === 401) throw new RelayError("github_signed_out", "Relay's GitHub sign-in expired. Open Relay on Windows and Continue with GitHub again.");
    if (result.status >= 400) throw new RelayError("github", `GitHub: ${String(result.body.message ?? result.status)} (${path.split("?")[0]})`);
    return result.body;
  }

  /** Creates or updates the alarm repository, its secret and its workflow. */
  async sync(codespaceName: string, crons: string[]): Promise<{ repoUrl: string; changed: boolean }> {
    const user = await this.ok("/user");
    const login = String(user.login);
    const repoPath = `/repos/${login}/${ALARM_REPO}`;
    let repo = await this.call(repoPath);
    if (repo.status === 404) {
      await this.ok("/user/repos", {
        method: "POST",
        body: JSON.stringify({ name: ALARM_REPO, private: true, auto_init: true, description: "Wakes your Relay cloud desktop for scheduled bots. Managed by Relay." }),
      });
      repo = await this.call(repoPath);
    }
    if (repo.status >= 400) throw new RelayError("github", `GitHub: ${String(repo.body.message ?? repo.status)} (${repoPath})`);

    const key = await this.ok(`${repoPath}/actions/secrets/public-key`);
    const sealed = sealedbox.seal(new TextEncoder().encode(this.token), Buffer.from(String(key.key), "base64"));
    await this.ok(`${repoPath}/actions/secrets/RELAY_TOKEN`, {
      method: "PUT",
      body: JSON.stringify({ encrypted_value: Buffer.from(sealed).toString("base64"), key_id: key.key_id }),
    });

    const content = workflowYaml(codespaceName, crons);
    const existing = await this.call(`${repoPath}/contents/${WORKFLOW_PATH}`);
    const sha = existing.status === 200 ? String(existing.body.sha) : undefined;
    const current = existing.status === 200 ? Buffer.from(String(existing.body.content ?? ""), "base64").toString("utf8") : null;
    if (current === content) return { repoUrl: `https://github.com/${login}/${ALARM_REPO}`, changed: false };
    await this.ok(`${repoPath}/contents/${WORKFLOW_PATH}`, {
      method: "PUT",
      body: JSON.stringify({ message: "Update Relay wake-up times", content: Buffer.from(content).toString("base64"), ...(sha ? { sha } : {}) }),
    });
    return { repoUrl: `https://github.com/${login}/${ALARM_REPO}`, changed: true };
  }
}
