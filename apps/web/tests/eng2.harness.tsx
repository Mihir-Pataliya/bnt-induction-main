import React from "react";
import { createRoot } from "react-dom/client";
import { CORAdmin } from "../src/components/admin/CORAdmin";
import "../src/styles.css";
import type { SessionState } from "../src/types";

const testSession: SessionState = {
  accessToken: "test-only",
  refreshToken: "test-only",
  user: { id: "00000000-0000-0000-0000-000000000000", email: "test@test.local", role: "admin", driverId: null }
};
createRoot(document.getElementById("root")!).render(<CORAdmin session={testSession} />);
