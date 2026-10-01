import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion.js";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/components/lib/utils.js";

const LABEL_ROLL_TRANSITION = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1],
} as const;

export function RollingToolbarLabel({
  label,
  className,
  prefix,
  prefixClassName,
  value,
}: {
  label: string;
  className?: string;
  prefix?: string;
  prefixClassName?: string;
  value?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const content =
    prefix !== undefined && value !== undefined ? (
      <>
        <span className={prefixClassName}>{prefix}</span>
        <span>{value}</span>
      </>
    ) : (
      label
    );

  if (reducedMotion) {
    return (
      <span className={className} title={label}>
        {content}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "relative inline-flex h-[1.3em] min-w-0 items-center overflow-hidden leading-[1.25]",
        className,
      )}
      title={label}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label}
          className="inline-flex min-w-0 whitespace-nowrap leading-[1.25]"
          initial={{ y: "0.75em", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-0.75em", opacity: 0 }}
          transition={LABEL_ROLL_TRANSITION}
        >
          {content}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
