import { type FormEvent, useState } from "react";
import { api, ApiError, type CloudUser } from "./api";

interface AuthScreenProps {
  onSignedIn: (user: CloudUser) => void;
  /** Shown when the visitor arrived from a subcontractor invite link. */
  inviteMode: boolean;
}

type Mode = "signin" | "register";

function AuthScreen({ onSignedIn, inviteMode }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>(inviteMode ? "register" : "signin");
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user =
        mode === "signin"
          ? await api.login(email, password)
          : await api.register({ companyName, name, email, password });
      onSignedIn(user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Curb Connect</p>
        <h1>{mode === "signin" ? "Sign in" : "Create your company account"}</h1>
        <p className="auth-copy">
          {inviteMode
            ? "You were invited to a job. Sign in or create your company's account to join it."
            : "Contractors and subcontractors share jobs, field updates, files, and invoices in one place."}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "register" ? (
            <>
              <label>
                Company name
                <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required autoComplete="organization" />
              </label>
              <label>
                Your name
                <input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
              </label>
            </>
          ) : null}
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === "register" ? 10 : 1}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
            {mode === "register" ? <small>At least 10 characters.</small> : null}
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "signin" ? "New to Curb Connect?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(mode === "signin" ? "register" : "signin");
              setError("");
            }}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  );
}

export default AuthScreen;
