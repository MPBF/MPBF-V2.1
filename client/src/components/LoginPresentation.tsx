import type { FormEvent, ReactNode } from "react";
import { Factory } from "lucide-react";
import type { BrandingSnapshot } from "../lib/branding";
import "./LoginPresentation.css";

type LoginPresentationProps = {
  branding: BrandingSnapshot;
  languageSwitcher: ReactNode;
  heading: string;
  subtitle: string;
  usernameLabel: string;
  passwordLabel: string;
  submitLabel: string;
  error: string;
  username: string;
  password: string;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export default function LoginPresentation({
  branding,
  languageSwitcher,
  heading,
  subtitle,
  usernameLabel,
  passwordLabel,
  submitLabel,
  error,
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: LoginPresentationProps) {
  return (
    <main className="login-redesign">
      <div className="login-redesign__language">{languageSwitcher}</div>
      <section className="login-redesign__card" aria-labelledby="login-welcome">
        <header className="login-redesign__identity">
          <span className="login-redesign__company-ar" lang="ar" dir="rtl">{branding.companyNameAr}</span>
          <span className="login-redesign__company-en" lang="en" dir="ltr">{branding.companyNameEn}</span>
        </header>

        <div className="login-redesign__logo">
          {branding.logoSrc
            ? <img src={branding.logoSrc} alt={`${branding.companyNameAr} — ${branding.companyNameEn}`} />
            : <Factory aria-hidden="true" />}
        </div>

        <div className="login-redesign__welcome">
          <h1 id="login-welcome" dir="auto">{heading}</h1>
          <p>{subtitle}</p>
        </div>

        <form className="login-redesign__form" onSubmit={onSubmit}>
          {error && <div className="login-redesign__error" role="alert" aria-live="assertive">{error}</div>}
          <div className="field login-redesign__field">
            <label htmlFor="login-username">{usernameLabel}</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              dir="auto"
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
            />
          </div>
          <div className="field login-redesign__field">
            <label htmlFor="login-password">{passwordLabel}</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </div>
          <button className="btn btn-primary login-redesign__submit" type="submit">{submitLabel}</button>
        </form>
      </section>
    </main>
  );
}
