$(function () {
  if (window.AOS) {
    AOS.init({
      duration: 650,
      easing: "ease-out-cubic",
      once: true,
      offset: 60
    });
  }

  if (window.lucide) {
    lucide.createIcons();
  }

  $(".delete-form, form[action$='/delete']").on("submit", function (event) {
    if (!window.confirm("Delete this item?")) {
      event.preventDefault();
    }
  });

  $(".filter-panel select").on("change", function () {
    const form = $(this).closest("form");
    if (form.data("autosubmit") === true) {
      form.trigger("submit");
    }
  });

  const checkoutForm = $("[data-checkout-form]");
  function updateCheckoutTotal() {
    if (!checkoutForm.length) return;
    const total = checkoutForm.find("[data-checkout-total]");
    const selected = checkoutForm.find("[data-ticket-option] option:selected");
    const cents = Number(selected.data("price") || total.data("external-price") || 0);
    const quantity = Math.max(1, Number(checkoutForm.find("[data-quantity]").val()) || 1);
    total.text(
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0
      }).format((cents * quantity) / 100)
    );
  }
  checkoutForm.on("input change", "[data-ticket-option], [data-quantity]", updateCheckoutTotal);
  updateCheckoutTotal();
});
