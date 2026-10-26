import { useEffect, useState } from "react";
import App from "../App";
import { api, ApiError, getToken, onUnauthorized, setToken, type CloudUser } from "./api";
import AuthScreen from "./AuthScreen";

function readInviteToken(): string | null {
  return new URLSearchParams(window.location.search).get("invite");
}

function clearInviteFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", url.toString());
}

/** Signed-in mode: restores the session, shows sign-in when needed, and joins invited jobs. */
function CloudRoot() {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [checking, setChecking] = useState(() => Boolean(getToken()));
  const [notice, setNotice] = useState("");
  const [inviteToken, setInviteToken] = useState(readInviteToken);

  useEffect(() => onUnauthorized(() => setUser(null)), []);

  useEffect(() => {
    if (!getToken()) {
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!user || !inviteToken) {
      return;
    }
    api
      .acceptInvite(inviteToken)
      .then((project) => setNotice(`You joined "${project.name}" as the subcontractor.`))
      .catch((error) => setNotice(error instanceof ApiError ? error.message : "Could not join that job."))
      .finally(() => {
        clearInviteFromUrl();
        setInviteToken(null);
      });
  }, [user, inviteToken]);

  if (checking) {
    return (
      <main className="auth-shell">
        <p className="empty-state">Loading your account…</p>
      </main>
    );
  }

  if (!user) {
    return <AuthScreen onSignedIn={setUser} inviteMode={Boolean(inviteToken)} />;
  }

  return (
    <App
      cloud={{
        user,
        notice,
        onDismissNotice: () => setNotice(""),
        onCompanyUpdated: (company) => setUser({ ...user, company }),
        onSignOut: () => {
          setToken(null);
          setUser(null);
        }
      }}
    />
  );
}

export default CloudRoot;
