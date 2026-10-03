import { Moon } from "lucide-react";
import { useEffect, useState } from "react";

function initialTheme(): "light" | "dark" {
	if (typeof window === "undefined") return "light";
	const saved = window.localStorage.getItem("theme");
	if (saved === "light" || saved === "dark") return saved;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function ThemeToggle() {
	const [theme, setTheme] = useState<"light" | "dark">(initialTheme);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		window.localStorage.setItem("theme", theme);
	}, [theme]);

	return (
		// A rail button (ui v1) – the rail is its one home.
		<button
			type="button"
			className="rbtn"
			title="Toggle theme"
			aria-label="Toggle theme"
			onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
		>
			<Moon aria-hidden="true" />
			<span className="tip" aria-hidden="true">
				Theme
			</span>
		</button>
	);
}
