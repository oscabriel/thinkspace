import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@thinkspace/ui/lib/utils";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

const markerVariants = cva(
  "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-xs text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground",
  {
    variants: {
      variant: {
        border: "border-b border-border pb-2",
        default: "",
        separator:
          "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border",
      },
    },
  }
);

const Marker = ({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof markerVariants>) =>
  useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(markerVariants({ className, variant })),
      },
      props
    ),
    render,
    state: {
      slot: "marker",
      variant,
    },
  });

const MarkerIcon = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span
    data-slot="marker-icon"
    aria-hidden="true"
    className={cn(
      "size-3.5 shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
      className
    )}
    {...props}
  />
);

const MarkerContent = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    data-slot="marker-content"
    className={cn(
      "min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
      className
    )}
    {...props}
  />
);

export { Marker, MarkerIcon, MarkerContent, markerVariants };
