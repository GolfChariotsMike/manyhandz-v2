import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { verifyMagicLink } from "../lib/api";
import { Check, XCircle, Loader2 } from "lucide-react";

export default function Verify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("No token found in link. Please request a new one.");
      setStatus("error");
      return;
    }
    verifyMagicLink(token)
      .then(({ isNew, customer }) => {
        setStatus("success");
        setTimeout(() => {
          if (isNew || !customer?.onboarding_complete) {
            navigate("/onboarding");
          } else {
            navigate("/");
          }
        }, 1000);
      })
      .catch((err: any) => {
        setError(err.message || "This link is invalid or has expired.");
        setStatus("error");
      });
  }, []);

  return (
    <div className="min-h-screen aurora-bg flex items-center justify-center p-4">
      <div className="aurora-card aurora-glow p-10 w-full max-w-md text-center">
        {status === "loading" && (
          <>
            <Loader2 className="animate-spin text-yellow-400 mx-auto mb-4" size={40} />
            <h2 className="text-xl font-semibold">Signing you in...</h2>
          </>
        )}
        {status === "success" && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <Check className="text-green-400" size={32} />
            </div>
            <h2 className="text-xl font-semibold">You're in! Redirecting...</h2>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <XCircle className="text-red-400" size={32} />
            </div>
            <h2 className="text-xl font-semibold mb-3">Link expired</h2>
            <p className="text-white/50 text-sm mb-6">{error}</p>
            <a href="/login" className="btn-primary inline-block">Request a new link</a>
          </>
        )}
      </div>
    </div>
  );
}
