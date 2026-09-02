const IGLOUE_CALENDAR = {
  locale: "fr-FR",

  months: [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre"
  ],

  weekdays: [
    "L",
    "M",
    "M",
    "J",
    "V",
    "S",
    "D"
  ]
};

function calendarDateToValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function calendarValueToDate(value) {
  if (!value) {
    return null;
  }

  const [year, month, day] =
    value.split("-").map(Number);

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0
  );
}

function getCalendarToday() {
  const now = new Date();

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0
  );
}

function getFirstBookableDate() {
  const date = getCalendarToday();

  date.setDate(
    date.getDate() + 1
  );

  return date;
}

function sameCalendarDay(a, b) {
  if (!a || !b) {
    return false;
  }

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isCalendarDateBetween(
  date,
  start,
  end
) {
  if (!start || !end) {
    return false;
  }

  return (
    date > start &&
    date < end
  );
}

function createIgloueCalendar({
  container,
  startDate = "",
  endDate = "",
  onChange
}) {
  if (!container) {
    return;
  }

  let selectedStart =
    calendarValueToDate(startDate);

  let selectedEnd =
    calendarValueToDate(endDate);

  const today =
    getCalendarToday();

  const firstBookable =
    getFirstBookableDate();

  let visibleMonth =
    selectedStart
      ? new Date(
          selectedStart.getFullYear(),
          selectedStart.getMonth(),
          1
        )
      : new Date(
          firstBookable.getFullYear(),
          firstBookable.getMonth(),
          1
        );

  function emitChange() {
    if (typeof onChange !== "function") {
      return;
    }

    onChange({
      startDate:
        selectedStart
          ? calendarDateToValue(selectedStart)
          : "",

      endDate:
        selectedEnd
          ? calendarDateToValue(selectedEnd)
          : ""
    });
  }

  function selectDate(date) {
    if (date < firstBookable) {
      return;
    }

    if (
      !selectedStart ||
      selectedEnd
    ) {
      selectedStart = date;
      selectedEnd = null;
    } else if (
      date <= selectedStart
    ) {
      selectedStart = date;
      selectedEnd = null;
    } else {
      selectedEnd = date;
    }

    emitChange();
    render();
  }

  function render() {
    const year =
      visibleMonth.getFullYear();

    const month =
      visibleMonth.getMonth();

    const firstDay =
      new Date(
        year,
        month,
        1,
        12
      );

    const lastDay =
      new Date(
        year,
        month + 1,
        0,
        12
      );

    /*
      JS Sunday = 0.
      Convert calendar so Monday = 0.
    */
    const leadingDays =
      (firstDay.getDay() + 6) % 7;

    const days = [];

    for (
      let i = 0;
      i < leadingDays;
      i += 1
    ) {
      days.push(
        `<span class="igloue-calendar-empty"></span>`
      );
    }

    for (
      let day = 1;
      day <= lastDay.getDate();
      day += 1
    ) {
      const date =
        new Date(
          year,
          month,
          day,
          12
        );

      const value =
        calendarDateToValue(date);

      const isPast =
        date < today;

      const isToday =
        sameCalendarDay(
          date,
          today
        );

      const isUnavailable =
        date < firstBookable;

      const isStart =
        selectedStart &&
        sameCalendarDay(
          date,
          selectedStart
        );

      const isEnd =
        selectedEnd &&
        sameCalendarDay(
          date,
          selectedEnd
        );

      const isBetween =
        isCalendarDateBetween(
          date,
          selectedStart,
          selectedEnd
        );

      const classes = [
        "igloue-calendar-day"
      ];

      if (isPast) {
        classes.push("is-past");
      }

      if (isToday) {
        classes.push("is-today");
      }

      if (isUnavailable) {
        classes.push("is-unavailable");
      }

      if (isStart) {
        classes.push("is-start");
      }

      if (isEnd) {
        classes.push("is-end");
      }

      if (isBetween) {
        classes.push("is-between");
      }

      days.push(`
        <button
          class="${classes.join(" ")}"
          type="button"
          data-calendar-date="${value}"
          ${isUnavailable ? "disabled" : ""}
          aria-label="${date.toLocaleDateString(
            IGLOUE_CALENDAR.locale,
            {
              weekday: "long",
              day: "numeric",
              month: "long"
            }
          )}">

          <span>${day}</span>

          ${
            isToday
              ? `<small>Auj.</small>`
              : ""
          }

        </button>
      `);
    }

    const canGoPrevious =
      (
        visibleMonth.getFullYear() >
        firstBookable.getFullYear()
      ) ||
      (
        visibleMonth.getFullYear() ===
          firstBookable.getFullYear() &&
        visibleMonth.getMonth() >
          firstBookable.getMonth()
      );

    container.innerHTML = `
      <div class="igloue-calendar">

        <div class="igloue-calendar-header">

          <button
            type="button"
            class="igloue-calendar-nav"
            data-calendar-prev
            aria-label="Mois précédent"
            ${canGoPrevious ? "" : "disabled"}>
            ←
          </button>

          <strong>
            ${
              IGLOUE_CALENDAR.months[month]
            }
            ${year}
          </strong>

          <button
            type="button"
            class="igloue-calendar-nav"
            data-calendar-next
            aria-label="Mois suivant">
            →
          </button>

        </div>

        <div class="igloue-calendar-weekdays">
          ${IGLOUE_CALENDAR.weekdays
            .map(
              (weekday) =>
                `<span>${weekday}</span>`
            )
            .join("")}
        </div>

        <div class="igloue-calendar-grid">
          ${days.join("")}
        </div>

        <div class="igloue-calendar-legend">
          <span>
            <i class="calendar-legend-today"></i>
            Aujourd’hui
          </span>

          <span>
            <i class="calendar-legend-selected"></i>
            Votre location
          </span>
        </div>

      </div>
    `;

    container
      .querySelectorAll(
        "[data-calendar-date]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            selectDate(
              calendarValueToDate(
                button.dataset.calendarDate
              )
            );
          }
        );
      });

    const previousButton =
      container.querySelector(
        "[data-calendar-prev]"
      );

    const nextButton =
      container.querySelector(
        "[data-calendar-next]"
      );

    previousButton?.addEventListener(
      "click",
      () => {
        visibleMonth =
          new Date(
            year,
            month - 1,
            1
          );

        render();
      }
    );

    nextButton?.addEventListener(
      "click",
      () => {
        visibleMonth =
          new Date(
            year,
            month + 1,
            1
          );

        render();
      }
    );
  }

  render();
}