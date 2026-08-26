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
		<button
			type="button"
			className="tool-btn"
			title="Toggle theme"
			aria-label="Toggle theme"
			onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
		>
			<Moon aria-hidden="true" />
		</button>
	);
}
