import React from "react";
import { createRoot } from "react-dom/client";
import { CORAdmin } from "../src/components/admin/CORAdmin";
import { CORPage } from "../src/components/driver/CORPage";
import "../src/styles.css";
import type { SessionState } from "../src/types";

const isDriver = new URLSearchParams(window.location.search).get("role") === "driver";
const session: SessionState = {
  accessToken: "test-only",
  refreshToken: "test-only",
  user: {
    id: isDriver ? "22222222-2222-4222-8222-222222222222" : "11111111-1111-4111-8111-111111111111",
    email: isDriver ? "driver@test.local" : "admin@test.local",
    role: isDriver ? "driver" : "admin",
    driverId: null
  }
};

const app = isDriver
  ? <CORPage
      driverBundle={{ driver: { fullName: "Test Driver", staffRole: "driver" } } as never}
      session={session}
      onNavigateTab={() => {}}
    />
  : <CORAdmin session={session} />;

createRoot(document.getElementById("root")!).render(app);
