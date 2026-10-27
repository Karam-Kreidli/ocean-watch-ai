import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GuestLink from "@/components/GuestLink";
import AuthLayout from "@/components/AuthLayout";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);

    if (error) {
      setUnconfirmed(error.code === "email_not_confirmed");
      const description = error.code === "email_not_confirmed"
        ? "Confirm your email first: open the link we sent you."
        : error.code === "invalid_credentials" ? "Wrong email or password." : error.message;
      toast({ title: "Login failed", description, variant: "destructive" });
      return;
    }
    toast({ title: "Welcome back" });
    navigate("/dashboard");
  };

  const resend = async () => {
    const { error } = await supabase.auth.resend({
      type: "signup", email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    toast(error
      ? { title: "Couldn't send it", description: error.message, variant: "destructive" }
      : { title: "Sent", description: "Check your inbox and spam folder." });
  };

  return (
    <AuthLayout>
    <div className="flex min-h-screen items-center justify-center px-4 pt-16">
      <div className="stagger w-full max-w-sm space-y-8">
        <div>
          <h1 className="font-display text-4xl">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Log in to see your videos and survey results.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="bg-muted/30 border-border/50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput id="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="bg-muted/30 border-border/50" />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Log in"}
          </Button>
        </form>

        {unconfirmed && (
          <p className="text-sm text-muted-foreground">
            No email?{" "}
            <button type="button" onClick={resend} className="text-primary hover:underline">Send the confirmation link again</button>
          </p>
        )}

        <p className="text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/signup" className="text-primary hover:underline">Sign up</Link>
        </p>
        <GuestLink />
      </div>
    </div>
    </AuthLayout>
  );
};

export default Login;
