"use client";

import { useThemeStore, Theme } from "@/store/theme";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
  { value: "light", icon: <Sun className="h-4 w-4" />, label: "Light" },
  { value: "system", icon: <Monitor className="h-4 w-4" />, label: "System" },
  { value: "dark", icon: <Moon className="h-4 w-4" />, label: "Dark" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="flex items-center bg-muted rounded-lg p-0.5">
      {options.map((opt) => (
        <Button
          key={opt.value}
          variant="ghost"
          size="sm"
          onClick={() => setTheme(opt.value)}
          aria-label={opt.label}
          className={cn(
            "h-7 w-7 p-0 rounded-md",
            theme === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-transparent"
          )}
        >
          {opt.icon}
        </Button>
      ))}
    </div>
  );
}
