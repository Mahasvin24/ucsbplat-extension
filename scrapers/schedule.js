const GOLD_SCHEDULE_PATH = "/gold/StudentSchedule.aspx";

function isStudentSchedulePage() {
  return (
    window.location.pathname.toLowerCase() === GOLD_SCHEDULE_PATH.toLowerCase()
  );
}

async function scrapeSchedule() {
  if (!isStudentSchedulePage()) {
    throw new Error("Schedule scraper must run on StudentSchedule.aspx.");
  }
  const scheduleContainer = document.querySelector("#div_Schedule_Container")
  // TODO: Extract schedule data from the StudentSchedule.aspx DOM.
  if (!scheduleContainer) {
    throw new Error("Schedule container not found.");
  }

  const scheduleHtml = scheduleContainer.outerHTML
  return scheduleHtml;
}
