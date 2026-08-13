document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector("[data-menu-toggle]");
  const navigation = document.querySelector("#mobile-nav");
  if (toggle && navigation) {
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      navigation.hidden = expanded;
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
      window.setTimeout(() => { button.textContent = original; }, 1600);
    });
  });

  const form = document.querySelector("[data-live-result]");
  if (form) {
    const result = form.querySelector("[data-result-code]");
    const recommendation = form.querySelector("[data-recommendation]");
    const fields = {
      vm: form.querySelector("#id_did_not_leave_vm"),
      accepting: form.querySelector("#id_accepting_new_patients"),
      treat: form.querySelector("#id_can_treat_diagnosis"),
      schedule: form.querySelector("#id_can_schedule_within_four_weeks"),
      urgent: form.querySelector("#id_urgent_referral_required"),
    };
    const update = () => {
      let phrase = "does not meet availability guidelines";
      if (fields.vm.checked) phrase = "unable to contact, did not leave voicemail";
      else if (fields.accepting.value === "yes" && fields.treat.value === "yes" && (fields.urgent.checked || fields.schedule.value === "urgent_referral_required")) phrase = "meets availability guidelines — urgent referral required";
      else if (fields.accepting.value === "yes" && fields.treat.value === "yes" && fields.schedule.value === "yes") phrase = "meets availability guidelines";
      result.textContent = phrase;
      if (fields.vm.checked) recommendation.textContent = "Call again after the unsuccessful contact attempt.";
      else if (fields.accepting.value === "yes" && (fields.schedule.value === "yes" || fields.urgent.checked)) recommendation.textContent = "Good provider to call; verify treatment for the diagnosis.";
      else if (fields.accepting.value === "no") recommendation.textContent = "Do not call; provider is not accepting new patients.";
      else recommendation.textContent = "Provider availability is not yet confirmed.";
    };
    Object.values(fields).forEach((field) => field && field.addEventListener("change", update));
    update();
  }
});
