import { NotificationSettings } from "@/app/components/notification-settings";
import { RunStore } from "@/lib/runs/run-store";
import { notificationConfigured } from "@/lib/server/failure-notifier";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await new RunStore().getWorkspaceSettings();
  return <div className="page narrow">
    <header className="page-head"><div><p className="eyebrow">Notifications</p><h1>Hear when it is done</h1><p className="muted">Research runs in the background. Set the address new runs email by default when results are ready or a run stops. Anyone starting a run can send that run&apos;s updates somewhere else.</p></div></header>
    <NotificationSettings
      initial={{ email: settings.notification_email ?? "", onSuccess: settings.notify_on_success, onFailure: settings.notify_on_failure }}
      deliveryConfigured={notificationConfigured()}
    />
  </div>;
}
