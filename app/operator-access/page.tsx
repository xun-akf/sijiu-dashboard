"use client";

import { useEffect } from "react";
import { siteUrl } from "@/lib/dashboard-browser";

export default function OperatorAccessPage() {
  useEffect(() => {
    window.location.replace(siteUrl("/access"));
  }, []);
  return null;
}
