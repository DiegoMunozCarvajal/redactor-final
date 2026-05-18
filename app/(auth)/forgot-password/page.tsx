"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/auth/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { BookOpen, CheckCircle2, Loader2 } from "lucide-react";

const schema = z.object({
  email: z.string().email("Ingresa un correo electrónico válido."),
});

type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setError(null);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/callback?next=/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo,
      });

      if (error) {
        throw error;
      }

      setSubmittedEmail(data.email);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send password reset email",
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center pb-4">
          <BookOpen className="h-8 w-8 mx-auto text-primary mb-2" />
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>
            We&apos;ll email you a secure link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center space-y-2">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
                <p className="text-sm">
                  If an account exists for{" "}
                  <span className="font-medium">{submittedEmail}</span>, a reset
                  link has been sent.
                </p>
                <p className="text-xs text-muted-foreground">
                  Open the email and follow the link to choose a new password.
                </p>
              </div>
              <Button asChild className="w-full" variant="outline">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...register("email")}
                />
                {errors.email && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.email.message}
                  </p>
                )}
              </div>

              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Send reset link
              </Button>

              <Button asChild variant="ghost" className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
