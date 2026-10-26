import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  className,
  overlayClassName,
  children,
  side = "bottom",
  title,
  ...props
}: React.ComponentProps<typeof Dialog.Content> & {
  side?: "bottom" | "right" | "center";
  title: string;
  overlayClassName?: string;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className={cn("fixed inset-0 z-50 bg-overlay/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0", overlayClassName)} />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex flex-col bg-card text-card-fg shadow-soft outline-none",
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t border-border p-5 pb-8",
          side === "right" &&
            "inset-y-0 right-0 h-full w-[min(100%,22rem)] border-l border-border p-5",
          side === "center" &&
            "left-1/2 top-1/2 w-[min(100%-1.5rem,26rem)] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border p-5",
          className,
        )}
        {...props}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <Dialog.Title className="font-display text-lg font-semibold tracking-tight">
            {title}
          </Dialog.Title>
          <Dialog.Close className="flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
