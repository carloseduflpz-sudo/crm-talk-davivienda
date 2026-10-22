import { describe, expect, it } from "vitest";
import { agentRenames, homologateAgents, nameTokens } from "./agentes";

const v = (raw: string, rows = 10) => ({ raw, rows });
const groupOf = (groups: ReturnType<typeof homologateAgents>, raw: string) => groups.find((g) => g.variants.includes(raw));

describe("homologación de agentes", () => {
  it("palabras sin tildes, mayúsculas, puntos ni partículas", () => {
    expect(nameTokens("  MARÍA  de los Ángeles  López. ")).toEqual(["maria", "angeles", "lopez"]);
    expect(nameTokens("Peña")).toEqual(["pena"]);
  });

  it("une mayúsculas, tildes, espacios y orden distinto", () => {
    const g = homologateAgents([v("MARIA LOPEZ", 500), v("María López", 40), v("maria  lopez", 3), v("LOPEZ MARIA", 7)]);
    expect(g).toHaveLength(1);
    expect(g[0]!.name).toBe("María López");
    expect(g[0]!.variants).toHaveLength(4);
  });

  it("el nombre corto se une al completo y se muestra el completo con tildes", () => {
    const g = homologateAgents([v("MARIA JOSE LOPEZ RIVERA", 300), v("María López", 900), v("Jose Martinez", 50)]);
    expect(g).toHaveLength(2);
    expect(groupOf(g, "María López")!.name).toBe("María Jose López Rivera");
    expect(groupOf(g, "MARIA JOSE LOPEZ RIVERA")).toBe(groupOf(g, "María López"));
  });

  it("errores de una letra en palabras largas", () => {
    const g = homologateAgents([v("José Martínez"), v("JOSE MARTINES"), v("Jose Martinex")]);
    expect(g).toHaveLength(1);
    expect(g[0]!.name).toBe("José Martínez");
  });

  it("no une personas distintas", () => {
    const g = homologateAgents([v("Ana Rivera"), v("Ana Rivas"), v("Karla Mendez"), v("Karla Menendez"), v("Jose Lopez"), v("Rosa Lopez"), v("Luis"), v("Luis Hernandez")]);
    expect(g).toHaveLength(8);
  });

  it("si un nombre corto puede ser de dos agentes, queda aparte", () => {
    const g = homologateAgents([v("Maria Jose Lopez Rivera"), v("Maria Lopez Hernandez"), v("Maria Lopez")]);
    expect(g).toHaveLength(3);
    // Pero su misma forma en mayúsculas sí se une con ella.
    const g2 = homologateAgents([v("Maria Jose Lopez Rivera"), v("Maria Lopez Hernandez"), v("Maria Lopez"), v("MARIA LOPEZ")]);
    expect(g2).toHaveLength(3);
    expect(groupOf(g2, "MARIA LOPEZ")).toBe(groupOf(g2, "Maria Lopez"));
  });

  it("solo devuelve los nombres que cambian; mismo resultado sin importar el orden", () => {
    const names = [v("OSCAR FLORES", 80), v("Óscar Flores", 20), v("Sofía Castillo", 5)];
    const r = agentRenames(homologateAgents(names));
    expect([...r]).toEqual([["OSCAR FLORES", "Óscar Flores"]]);
    expect(homologateAgents([...names].reverse())).toEqual(homologateAgents(names));
  });

  it("todo en mayúsculas sin tildes: queda en mayúsculas y minúsculas normales", () => {
    const g = homologateAgents([v("KARLA MENDEZ DE LA O"), v("karla mendez")]);
    expect(g).toHaveLength(1);
    expect(g[0]!.name).toBe("Karla Mendez de la O");
  });
});
