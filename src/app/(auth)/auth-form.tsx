"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthState } from "./actions";

export type AuthField = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
};

export function AuthForm({
  title,
  description,
  fields,
  submitLabel,
  action,
  hidden,
  footer,
}: {
  title: string;
  description?: string;
  fields: AuthField[];
  submitLabel: string;
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  hidden?: Record<string, string>;
  footer?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {state?.message ? (
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            {state.message}
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            {Object.entries(hidden ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {fields.map((field) => (
              <div key={field.name} className="flex flex-col gap-2">
                <Label htmlFor={field.name}>{field.label}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type={field.type ?? "text"}
                  autoComplete={field.autoComplete}
                  placeholder={field.placeholder}
                  required
                  className="h-10"
                />
              </div>
            ))}
            {state?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
            <Button type="submit" size="lg" className="h-10" disabled={pending}>
              {pending ? "Un momento…" : submitLabel}
            </Button>
          </form>
        )}
        {footer ? <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
