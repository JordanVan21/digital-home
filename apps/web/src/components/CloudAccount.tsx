import { useEffect, useRef, useState } from "react";
import { CloudUpload, LogOut, UserRound } from "lucide-react";
import { editor } from "../state/editor";
import { loadCloudRooms, signOutCloud, supabase } from "../state/cloud";

/**
 * Sign in with the same account as the iPhone app to open its scanned rooms.
 * Signing in adds them to the room switcher and opens the newest one.
 */
export function CloudAccount() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void supabase.auth
      .getSession()
      .then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword(form);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setEmail(data.user.email ?? form.email);
    const ids = await loadCloudRooms();
    setBusy(false);
    setOpen(false);
    if (ids[0]) await editor.switchRoom(ids[0]);
    editor.notify(
      ids.length
        ? `Loaded ${ids.length} scanned room${ids.length === 1 ? "" : "s"}.`
        : "Signed in. No processed scans yet.",
    );
  };

  const signOut = async () => {
    setOpen(false);
    await signOutCloud();
    setEmail(null);
    editor.notify("Signed out. Scanned rooms stay on the server.");
  };

  return (
    <div className="menu-container" ref={container}>
      <button
        className="room-switcher glass-inset"
        aria-label={email ? `Account: ${email}` : "Sign in to open your scans"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {email ? <UserRound size={16} /> : <CloudUpload size={16} />}
        <span>{email ? "My scans" : "Sign in"}</span>
      </button>
      {open && (
        <div className="room-menu glass" role="dialog" aria-label="Account">
          {email ? (
            <>
              <p className="cloud-account-email">{email}</p>
              <button onClick={() => void signOut()}>
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </>
          ) : (
            <form
              className="cloud-signin"
              onSubmit={(e) => {
                e.preventDefault();
                void signIn();
              }}
            >
              <p>Use the same account as the House iPhone app.</p>
              <input
                type="email"
                placeholder="Email"
                autoComplete="username"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <input
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              {error && <p className="cloud-error">{error}</p>}
              <button type="submit" disabled={busy || !form.email || !form.password}>
                <span>{busy ? "Signing in…" : "Sign in"}</span>
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
