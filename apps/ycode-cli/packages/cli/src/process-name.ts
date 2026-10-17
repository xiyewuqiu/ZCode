export const CLI_COMMAND_NAME = "ycode";
export const CLI_PROCESS_NAME = "ycode-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
