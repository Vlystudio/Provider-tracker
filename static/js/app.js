document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector("[data-menu-toggle]");
  const drawer = document.querySelector("#site-drawer");
  const closeButtons = document.querySelectorAll("[data-menu-close]");
  const scrim = document.querySelector(".drawer-scrim");

  if (toggle && drawer && scrim) {
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const openMenu = () => {
      drawer.hidden = false;
      scrim.hidden = false;
      drawer.setAttribute("aria-hidden", "false");
      toggle.setAttribute("aria-expanded", "true");
      document.body.classList.add("drawer-open");
      drawer.querySelector(focusableSelector)?.focus();
    };

    const closeMenu = () => {
      drawer.hidden = true;
      scrim.hidden = true;
      drawer.setAttribute("aria-hidden", "true");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("drawer-open");
      toggle.focus();
    };

    toggle.addEventListener("click", openMenu);
    closeButtons.forEach((button) => button.addEventListener("click", closeMenu));

    drawer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = [...drawer.querySelectorAll(focusableSelector)];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !drawer.hidden) closeMenu();
    });
  }

  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", () => form.classList.add("is-submitting"));
  });

  document.querySelectorAll("[data-confirm]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (!window.confirm(button.dataset.confirm)) event.preventDefault();
    });
  });

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.querySelector(button.dataset.copyTarget);
      if (!target) return;
      await navigator.clipboard.writeText(target.textContent.trim());
      const original = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = original;
      }, 1600);
    });
  });
});
