"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";

interface CopyTextButtonProps extends Omit<ButtonProps, "onClick"> {
  text: string;
  successMessage?: string;
  errorMessage?: string;
  label?: string;
}

export function CopyTextButton({
  text,
  successMessage = "Copied",
  errorMessage = "Failed to copy",
  label = "Copy",
  disabled,
  ...buttonProps
}: CopyTextButtonProps) {
  const [copying, setCopying] = useState(false);

  async function handleCopy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch {
      toast.error(errorMessage);
    } finally {
      setCopying(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      disabled={disabled || copying}
      {...buttonProps}
    >
      {copying ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Copy className="mr-2 h-4 w-4" />
      )}
      {copying ? "Copying..." : label}
    </Button>
  );
}
