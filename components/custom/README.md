# Custom Components

Wrappers extending `components/ui/` with extra Tailwind classes or composed behavior.

**Rule:** Never edit `components/ui/` directly. Extend here via the Wrapper Pattern:

```tsx
import { Button } from "@/components/ui/button"

export function CustomButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button className={cn("your-extra-classes", className)} {...props} />
}
```

All custom components must re-export the original component's type signature and forward refs.
