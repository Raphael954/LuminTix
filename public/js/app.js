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
});
