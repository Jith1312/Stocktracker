import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-background p-4 overflow-hidden">
      <div className="absolute inset-0 bg-grid fade-grid pointer-events-none" />

      <div className="relative text-center rise-in">
        <div className="w-12 h-12 mx-auto rounded-xl bg-muted flex items-center justify-center mb-6">
          <SearchX className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-num text-6xl md:text-7xl font-semibold text-primary">404</p>
        <h1 className="font-display text-xl font-bold mt-4">Page not found</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
          This route doesn't exist. The signal you're looking for is elsewhere.
        </p>
        <Link href="/dashboard">
          <Button className="mt-6" data-testid="button-back-dashboard">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
