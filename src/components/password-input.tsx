"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * A password field with a show/hide toggle. Without JavaScript it is an ordinary password
 * input; the toggle only changes the input's type locally, nothing is sent anywhere.
 */
export function PasswordInput({
  showLabel,
  hideLabel,
  ...input
}: { showLabel: string; hideLabel: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field" dir="ltr">
      <input {...input} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? hideLabel : showLabel}
        aria-controls={input.id}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible ? null : <path d="M4 20 20 4" />}
        </svg>
      </button>
    </div>
  );
}
