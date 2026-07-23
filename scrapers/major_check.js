const GOLD_MAJOR_PROGRESS_PATH = "/gold/AcademicProgress.aspx";

function isProgressCheckPage() {
   return(
    window.location.pathname.toLowerCase() === GOLD_MAJOR_PROGRESS_PATH.toLowerCase()
   );
}



function findMajorDropdown(){
   const majorDropdown = document.querySelector("#pageContent_availableMajorsList")
   if (!majorDropdown){
    throw new Error ("Major dropdown not found.");
   }
   return majorDropdown;
}

function findMajorOption(majorDropdown, majorName){
    const options = majorDropdown.querySelectorAll("option")
    for (const option of options){
        if (option.textContent.trim().toLowerCase() === majorName.toLowerCase()){
            return option;
        }
    }
    throw new Error (`Major option not found: ${majorName}`);
}

function majorAlreadySelected(majorName){
    const majorDropdown = findMajorDropdown();
    const major = findMajorOption(majorDropdown, majorName);
    return major.selected;
}
    
function selectMajor(majorName){
    const majorDropdown = findMajorDropdown();
    const major = findMajorOption(majorDropdown, majorName);
    majorDropdown.value = major.value;
    majorDropdown.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectInProgress(){
    const checkbox = document.getElementById("pageContent_DegreeAuditWipDiv")
    if (!checkbox){
        throw new Error ("Checkbox not found.");
       }
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", {bubbles:true}))
}

function runProgressCheckButton(){
    const runButton = document.querySelector("#pageContent_runAuditBtn")
    if(!runButton){
        throw new Error ("Run button not found");
    }
    runButton.click();
}

function waitForProgressCheck(){
    return new Promise((resolve) =>{
        const interval = setInterval(() => {
            const isDone = document.querySelector("#pageContent_DA_titleLabel") !== null;
            if (isDone){
                clearInterval(interval);
                resolve();
            }
        }, 500);
        
    });
}

function ExpandAll(){
    const expandAllButton = document.querySelector("#pageContent_DA_ExpandAll")
    if(!expandAllButton){
        throw new Error ("Expand all button not found");
    }
    expandAllButton.click();
}

async function RunProgressCheck(){
    try{
        selectInProgress();
        runProgressCheckButton();
        await waitForProgressCheck();
        ExpandAll();
    } catch (error){
        console.error("Error running progress check:", error);
        throw error;
    }
}

function scrapeMajorProgressData(){
    const progressDataContainer = document.querySelector("#pageContent_pageContent_DA_GridPlaceHolderRadGrid")
    if(!progressDataContainer){
        throw new Error("Progress data not found");
    }
    const progressData = progressDataContainer.innerText;
    return progressData;
}

async function scrapeMajorProgress(majorName){
    if (!isProgressCheckPage()){
        throw new Error("Major progress check scraper must run on AcademicProgress.aspx.");
    }

    if (!majorAlreadySelected(majorName)){
        selectMajor(majorName);
    }
    await RunProgressCheck();
    const progressData = scrapeMajorProgressData();
    return progressData;
}


