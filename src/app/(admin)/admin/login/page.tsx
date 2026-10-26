import { Suspense } from "react";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <Suspense>
        <AdminLoginForm />
      </Suspense>
    </div>
  );
}
