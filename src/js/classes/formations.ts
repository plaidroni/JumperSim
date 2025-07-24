/**refer to .jump files for metrics */
export type FormationSlot = {
  stance: string;
  info: any;
  angleDeg: number;
  /* X,Y in meters */
  origin: [number, number];
};

export type FormationPoint = {
  inter: boolean;
  slots: FormationSlot[];
};

export type FormationJumper = {
  selected: boolean;
  planeSlot: any;
  person: any;
  color: string;
};

export type FormationPage = {
  point: number;
  singleLineLabel: boolean;
  title: string;
  slotColours: string;
  labels: number;
};

export type FormationExportInfo = {
  title: string;
  showSlotting: boolean;
  pages: FormationPage[];
};

/**directly pulled from .jump file in skydive designer */
export type FormationData = {
  title: string;
  docVersion: number;
  whiteBackpacks: boolean;
  people: any[];
  points: FormationPoint[];
  tunnelFt: number;
  jumpers: FormationJumper[];
  planes: any[];
  exportInfo: FormationExportInfo;
};

export class Formation {}
