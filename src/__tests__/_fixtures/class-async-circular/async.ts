const fetchRemote = async (): Promise<number> => 42;

const runAsync = async (): Promise<number> => {
  const data = await fetchRemote();
  return data;
};

export const asyncResultPromise = runAsync();