import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, Mail } from "lucide-react";
import { supabase } from "../lib/supabase";

type AuthMode = "sign-in" | "sign-up";

function readableAuthError(message: string): string {
  if (message.includes("Invalid login credentials")) {
    return "El correu o la contrasenya no són correctes.";
  }

  if (message.includes("Email not confirmed")) {
    return "Abans d'entrar, has de confirmar el correu electrònic.";
  }

  if (message.includes("User already registered")) {
    return "Ja existeix un compte registrat amb aquest correu.";
  }

  if (message.includes("Password should be")) {
    return "La contrasenya no compleix els requisits mínims.";
  }

  return message;
}

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPassword("");
    setPasswordConfirmation("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setNotice("");

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError("Escriu el teu correu electrònic.");
      return;
    }

    if (password.length < 8) {
      setError("La contrasenya ha de tenir com a mínim 8 caràcters.");
      return;
    }

    if (mode === "sign-up" && password !== passwordConfirmation) {
      setError("Les dues contrasenyes no coincideixen.");
      return;
    }

    setSubmitting(true);

    try {
      if (mode === "sign-in") {
        const { error: signInError } =
          await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password
          });

        if (signInError) {
          throw signInError;
        }

        return;
      }

      const { data, error: signUpError } =
        await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: window.location.origin
          }
        });

      if (signUpError) {
        throw signUpError;
      }

      if (!data.session) {
        setNotice(
          "Compte creat. Revisa el correu i prem l'enllaç de confirmació abans d'iniciar sessió."
        );

        setPassword("");
        setPasswordConfirmation("");
      }
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "No s'ha pogut completar l'operació.";

      setError(readableAuthError(message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="auth-brand">
          <div className="auth-brand-mark">
            <img src="/icons/icon-192.png" alt="" />
          </div>

          <div>
            <div className="auth-brand-name">Idearium</div>
            <div className="auth-brand-kicker">
              Arxiu personal d'idees
            </div>
          </div>
        </div>

        <div className="auth-intro-copy">
          <p className="eyebrow">El teu espai personal</p>

          <h1>Captura una idea abans que desaparegui.</h1>

          <p>
            Escriu, grava, classifica i desenvolupa notes des de
            qualsevol dispositiu.
          </p>
        </div>
      </section>

      <section className="auth-access">
        <div className="auth-card">
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              className={mode === "sign-in" ? "active" : ""}
              onClick={() => changeMode("sign-in")}
            >
              Iniciar sessió
            </button>

            <button
              type="button"
              className={mode === "sign-up" ? "active" : ""}
              onClick={() => changeMode("sign-up")}
            >
              Crear compte
            </button>
          </div>

          <div className="auth-card-heading">
            <p className="eyebrow">
              {mode === "sign-in"
                ? "Benvingut de nou"
                : "Comença a utilitzar Idearium"}
            </p>

            <h2>
              {mode === "sign-in"
                ? "Accedeix al teu espai"
                : "Crea el teu compte"}
            </h2>

            <p>
              {mode === "sign-in"
                ? "Introdueix el correu i la contrasenya amb què et vas registrar."
                : "Rebràs un correu per confirmar que l'adreça és teva."}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              <span>Correu electrònic</span>

              <div className="auth-input">
                <Mail size={17} />

                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="nom@correu.cat"
                  required
                />
              </div>
            </label>

            <label>
              <span>Contrasenya</span>

              <div className="auth-input">
                <KeyRound size={17} />

                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={
                    mode === "sign-in"
                      ? "current-password"
                      : "new-password"
                  }
                  placeholder="Com a mínim 8 caràcters"
                  minLength={8}
                  required
                />
              </div>
            </label>

            {mode === "sign-up" && (
              <label>
                <span>Repeteix la contrasenya</span>

                <div className="auth-input">
                  <KeyRound size={17} />

                  <input
                    type="password"
                    value={passwordConfirmation}
                    onChange={(event) =>
                      setPasswordConfirmation(event.target.value)
                    }
                    autoComplete="new-password"
                    placeholder="Torna a escriure la contrasenya"
                    minLength={8}
                    required
                  />
                </div>
              </label>
            )}

            {error && (
              <div className="auth-message error" role="alert">
                {error}
              </div>
            )}

            {notice && (
              <div className="auth-message success" role="status">
                {notice}
              </div>
            )}

            <button
              className="primary-button auth-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? "Processant..."
                : mode === "sign-in"
                  ? "Entrar a Idearium"
                  : "Crear el compte"}

              {!submitting && <ArrowRight size={18} />}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
