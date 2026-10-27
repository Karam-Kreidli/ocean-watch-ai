import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GuestLink from "@/components/GuestLink";
import AuthLayout from "@/components/AuthLayout";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

const Signup = () => {
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [organization, setOrganization] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [gender, setGender] = useState("");
  const [genderOpen, setGenderOpen] = useState(false);
  const genderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (genderRef.current && !genderRef.current.contains(e.target as Node)) {
        setGenderOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selectedLabel =
    GENDER_OPTIONS.find((o) => o.value === gender)?.label ?? "Select";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Friendly client-side validation — runs before any DB call
    if (!email.trim() || !password || !phone.trim() || !gender || !organization.trim()) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields before submitting.",
        variant: "destructive",
      });
      return;
    }
    if (password.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }
    if (!acceptedTerms) {
      toast({
        title: "Terms & Conditions required",
        description: "Please accept the Terms & Conditions to continue.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    const details = { phone, gender, organization, accepted_terms: acceptedTerms };

    // a guest keeps their account (and the videos they uploaded): it gets this email + password
    if (isGuest) {
      const { error: fnErr } = await supabase.functions.invoke("upgrade-guest", { body: { email, password, data: details } });
      if (fnErr) {
        setSubmitting(false);
        const body = await fnErr.context?.json?.().catch(() => null);
        toast({ title: "Sign-up failed", description: body?.error ?? fnErr.message, variant: "destructive" });
        return;
      }
      // a fresh session, so the app sees a normal account instead of the guest token
      const { error: inErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setSubmitting(false);
      if (inErr) {
        toast({ title: "Account created", description: "Log in with your new email and password." });
        navigate("/login");
        return;
      }
      toast({ title: "Account created", description: "Your uploads are kept." });
      navigate("/dashboard");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // the confirmation link opens the site the person signed up on (bioreef.ai or the
        // vercel.app address); sessions live per address, so landing on the other one logs nobody in
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: details,
      },
    });
    setSubmitting(false);

    if (error) {
      const description = error.code === "over_email_send_rate_limit"
        ? "Too many sign-ups in the last hour, so the confirmation email couldn't be sent. Please try again later."
        : error.message;
      toast({ title: "Sign-up failed", description, variant: "destructive" });
      return;
    }
    // Supabase answers an already-registered email with a fake user (no identities) and sends nothing
    if (data.user && data.user.identities?.length === 0) {
      toast({ title: "This email already has an account", description: "Log in instead." });
      navigate("/login");
      return;
    }
    // email confirmation turned off: they are signed in already
    if (data.session) {
      toast({ title: "Account created" });
      navigate("/dashboard");
      return;
    }
    toast({
      title: "Account created",
      description: "Check your email for a confirmation link, then log in.",
    });
    navigate("/login");
  };

  return (
    <AuthLayout>
    <div className="flex min-h-screen items-center justify-center px-4 pb-10 pt-24">
      <div className="stagger w-full max-w-sm space-y-8">
        <div>
          <h1 className="font-display text-4xl">Create an account</h1>
          <p className="mt-2 text-sm text-muted-foreground">{isGuest
            ? "Your videos from this guest session move to the new account."
            : "You need one to upload footage and keep the results."}</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="bg-muted/30 border-border/50" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput id="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="bg-muted/30 border-border/50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971..." className="bg-muted/30 border-border/50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <div className="relative" ref={genderRef}>
                <button
                  id="gender"
                  type="button"
                  onClick={() => setGenderOpen((o) => !o)}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                >
                  <span className={gender ? "text-foreground" : "text-muted-foreground"}>
                    {selectedLabel}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
                      genderOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {genderOpen && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                    {GENDER_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setGender(opt.value);
                          setGenderOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                          opt.value === gender ? "bg-accent text-foreground" : "text-foreground hover:bg-accent"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org">Organization</Label>
            <Input id="org" required value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="University / Institution" className="bg-muted/30 border-border/50" />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} className="accent-primary mt-0.5" />
            <span>
              I accept the{" "}
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="text-primary hover:underline focus:outline-none"
                  >
                    Terms &amp; Conditions
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Terms &amp; Conditions</DialogTitle>
                    <DialogDescription>
                      Last updated: April 2026
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 text-sm text-foreground/90 leading-relaxed">
                    <section>
                      <h3 className="font-semibold mb-1">1. Acceptance of Terms</h3>
                      <p>
                        By creating an account on the BioReef.ai dashboard, you agree to be
                        bound by these Terms &amp; Conditions. If you do not agree to any part
                        of these terms, you must not register for or use the platform.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">2. Nature of the Service</h3>
                      <p>
                        BioReef.ai is an academic research platform that uses computer vision
                        and machine learning to detect, classify, and track fish species in
                        underwater video footage for the purpose of biodiversity assessment.
                        Predictions are generated by AI models and are provided for research
                        and informational purposes only. They are not guaranteed to be accurate
                        and must not be used as the sole basis for regulatory, commercial,
                        ecological, or fisheries-management decisions.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">3. Account Registration</h3>
                      <p>
                        You agree to provide accurate, current, and complete information during
                        registration, including a valid email address, phone number, and your
                        affiliated organization. You are responsible for maintaining the
                        confidentiality of your password and for all activities that occur
                        under your account.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">4. Personal Data &amp; Privacy</h3>
                      <p>
                        We collect the personal information you provide (email, phone, gender,
                        organization) solely for the purposes of authentication, account
                        management, and aggregate research analytics. Your data will not be
                        sold to third parties. You may request deletion of your account and
                        associated personal data at any time by contacting the project team.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">5. Acceptable Use</h3>
                      <p>
                        You agree not to (a) upload content you do not have the right to share,
                        (b) attempt to reverse-engineer, scrape, or disrupt the service, (c)
                        use the platform for unlawful purposes, or (d) misrepresent the
                        outputs of the system as expert taxonomic identification. Violation of
                        these terms may result in suspension or termination of your account.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">6. Intellectual Property</h3>
                      <p>
                        All software, models, model weights, dashboards, datasets owned by the
                        project, and visual designs comprising BioReef.ai remain the property
                        of the BioReef.ai project team and the host institution. Footage that
                        you upload remains your property; by uploading you grant the project a
                        non-exclusive, royalty-free license to process the footage for the
                        purpose of providing the service to you.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">7. Disclaimer of Warranties</h3>
                      <p>
                        The service is provided on an "as is" and "as available" basis without
                        warranties of any kind, express or implied. The project team does not
                        warrant that the service will be uninterrupted, error-free, or that
                        species classifications will be correct. Use of the platform is at
                        your own risk.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">8. Limitation of Liability</h3>
                      <p>
                        To the fullest extent permitted by law, the BioReef.ai project team,
                        contributors, and affiliated institutions shall not be liable for any
                        indirect, incidental, special, consequential, or punitive damages
                        arising out of your use of the platform, including but not limited to
                        loss of data, ecological misclassification, or research outcomes
                        derived from platform outputs.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">9. Modifications to the Service</h3>
                      <p>
                        We reserve the right to modify, suspend, or discontinue any part of the
                        service at any time, including the underlying machine-learning models.
                        Material changes to these Terms will be communicated to registered
                        users via email.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">10. Governing Law</h3>
                      <p>
                        These Terms are governed by the laws of the United Arab Emirates. Any
                        disputes arising out of or in connection with these Terms shall be
                        subject to the exclusive jurisdiction of the competent courts of the
                        UAE.
                      </p>
                    </section>

                    <section>
                      <h3 className="font-semibold mb-1">11. Contact</h3>
                      <p>
                        For questions about these Terms or to request data removal, contact the
                        project team at the email address provided on the platform's About
                        page.
                      </p>
                    </section>
                  </div>
                </DialogContent>
              </Dialog>
            </span>
          </label>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign up"}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">Log in</Link>
        </p>
        <GuestLink />
      </div>
    </div>
    </AuthLayout>
  );
};

export default Signup;
