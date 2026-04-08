import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

export function Drawer({ open, onOpenChange, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog.Root>
  );
}

export function DrawerTrigger({ asChild, children }) {
  return <Dialog.Trigger asChild={asChild}>{children}</Dialog.Trigger>;
}

export function DrawerContent({ className, children }) {
  return (
    <Dialog.Portal>
      {/* Background overlay */}
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
      {/* Drawer content */}
      <Dialog.Content
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-80 bg-white shadow-xl border-l transition-transform duration-300",
          "data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full",
          className
        )}
      >
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function DrawerHeader({ className, children }) {
  return <div className={cn("p-4 border-b", className)}>{children}</div>;
}

export function DrawerTitle({ className, children }) {
  return (
    <Dialog.Title
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    >
      {children}
    </Dialog.Title>
  );
}

export function DrawerDescription({ className, children }) {
  return (
    <Dialog.Description className={cn("text-sm text-gray-500", className)}>
      {children}
    </Dialog.Description>
  );
}

export function DrawerFooter({ className, children }) {
  return <div className={cn("p-4 border-t flex justify-end", className)}>{children}</div>;
}
