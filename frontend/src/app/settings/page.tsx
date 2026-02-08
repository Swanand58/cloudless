"use client";

import { withAuth } from "@/lib/withAuth";
import { AppHeader } from "@/components/AppHeader";
import { ProfileCard } from "@/components/settings/ProfileCard";
import { ChangePassword } from "@/components/settings/ChangePassword";
import { AdminInviteManagement } from "@/components/settings/InviteManagement";
import { SecurityInfo } from "@/components/settings/SecurityInfo";

function SettingsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader breadcrumb="Settings" />

      <main className="flex-1 px-6 lg:px-12 py-8">
        <div className="grid lg:grid-cols-2 gap-6">
          <ProfileCard />
          <ChangePassword />
          <AdminInviteManagement />
          <SecurityInfo />
        </div>
      </main>
    </div>
  );
}

export default withAuth(SettingsPage);
