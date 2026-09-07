import { describe, expect, it } from "vitest";
import { applyDeclarations, parseDeclaredEntities, splitFrontmatter } from "./doc-frontmatter";
import { sectionDocument } from "./units";

const FENCE = `---
schema: 1
docType: countries
entities:
  - name: The Salt Marches
    type: country
    aliases: []
    affiliations: []
    section: "The Salt Marches"
  - name: Harbour Town
    type: location
    aliases: [the Harbour, Old Harbour]
    affiliations: [The Merchant League]
    section: "Harbour Town"
---
# The Salt Marches
Flat country, badly drained.

# Harbour Town
A port of some size.
`;

describe("splitFrontmatter", () => {
  it("removes the fence from what the model reads", () => {
    // The folder source used to feed this YAML to the model as campaign fact.
    const { body } = splitFrontmatter(FENCE);
    expect(body.startsWith("# The Salt Marches")).toBe(true);
    expect(body).not.toContain("docType");
  });

  it("hands back the fence for mining", () => {
    expect(splitFrontmatter(FENCE).frontmatter).toContain("entities:");
  });

  it("leaves a document with no fence untouched", () => {
    const plain = "# Heading\nbody";
    expect(splitFrontmatter(plain)).toEqual({ frontmatter: "", body: plain });
  });

  it("does not treat a horizontal rule mid-document as a fence", () => {
    const rule = "# Heading\n\n---\n\nmore body";
    expect(splitFrontmatter(rule).frontmatter).toBe("");
  });

  it("handles CRLF, because the corpus has it", () => {
    const crlf = FENCE.replace(/\n/g, "\r\n");
    expect(splitFrontmatter(crlf).body.startsWith("# The Salt Marches")).toBe(true);
  });
});

describe("parseDeclaredEntities", () => {
  const declared = parseDeclaredEntities(splitFrontmatter(FENCE).frontmatter);

  it("reads every declared subject", () => {
    expect(declared.map(d => d.name)).toEqual(["The Salt Marches", "Harbour Town"]);
  });

  it("reads the declared type, so nothing has to be inferred", () => {
    expect(declared[0].type).toBe("country");
    expect(declared[1].type).toBe("location");
  });

  it("reads inline alias and affiliation lists", () => {
    expect(declared[1].aliases).toEqual(["the Harbour", "Old Harbour"]);
    expect(declared[1].affiliations).toEqual(["The Merchant League"]);
  });

  it("treats an empty list as empty, not as one blank entry", () => {
    expect(declared[0].aliases).toEqual([]);
  });

  it("reads block-style lists too", () => {
    const block = parseDeclaredEntities(
      ["entities:", "  - name: Someone", "    aliases:", "      - First", "      - Second"].join("\n")
    );
    expect(block[0].aliases).toEqual(["First", "Second"]);
  });

  it("stops at the next top-level key", () => {
    const trailing = parseDeclaredEntities(
      ["entities:", "  - name: Someone", "generatedBy: a tool", "  - name: NotAnEntity"].join("\n")
    );
    expect(trailing.map(d => d.name)).toEqual(["Someone"]);
  });

  it("returns nothing rather than throwing on frontmatter with no entities", () => {
    expect(parseDeclaredEntities("schema: 1\ndocType: notes")).toEqual([]);
  });

  it("survives malformed input, because prose must not be lost to bad YAML", () => {
    expect(() => parseDeclaredEntities("entities:\n  - : :\n   garbage")).not.toThrow();
  });

  it("does not carry a key's list items over to the next entity", () => {
    const two = parseDeclaredEntities(
      ["entities:", "  - name: A", "    aliases:", "      - one", "  - name: B"].join("\n")
    );
    expect(two[1].aliases).toEqual([]);
  });
});

describe("applyDeclarations", () => {
  it("gives the matching unit its declared type and aliases", () => {
    const { body, frontmatter } = splitFrontmatter(FENCE);
    const units = sectionDocument("Places.md", body);
    const result = applyDeclarations(units, parseDeclaredEntities(frontmatter));

    expect(result.matched).toBe(2);
    const harbour = units.find(u => u.title === "Harbour Town")!;
    expect(harbour.type).toBe("location");
    expect(harbour.aliases).toEqual(["the Harbour", "Old Harbour"]);
    expect(harbour.relations).toEqual([{ key: "affiliations", targets: ["The Merchant League"] }]);
  });

  it("does not add the declared name as an alias of itself", () => {
    const { body, frontmatter } = splitFrontmatter(FENCE);
    const units = sectionDocument("Places.md", body);
    applyDeclarations(units, parseDeclaredEntities(frontmatter));
    expect(units.find(u => u.title === "The Salt Marches")!.aliases).toEqual([]);
  });

  it("adds the declared name as an alias when the heading words it differently", () => {
    const units = sectionDocument("Places.md", "# Harbour Town, the port\nbody\n");
    applyDeclarations(units, [
      { name: "Harbour Town", aliases: [], affiliations: [], section: "Harbour Town, the port" },
    ]);
    expect(units[0].aliases).toEqual(["Harbour Town"]);
  });

  it("reports a declaration whose section no longer exists", () => {
    // Usually a renamed heading with stale metadata — worth surfacing rather
    // than silently ignoring.
    const units = sectionDocument("Places.md", "# Somewhere Else\nbody\n");
    const result = applyDeclarations(units, [
      { name: "Harbour Town", aliases: [], affiliations: [], section: "Harbour Town" },
    ]);
    expect(result.matched).toBe(0);
    expect(result.unmatched.map(d => d.name)).toEqual(["Harbour Town"]);
  });

  it("falls back to matching on name when no section is declared", () => {
    const units = sectionDocument("Places.md", "# Harbour Town\nbody\n");
    const result = applyDeclarations(units, [
      { name: "Harbour Town", type: "location", aliases: [], affiliations: [] },
    ]);
    expect(result.matched).toBe(1);
    expect(units[0].type).toBe("location");
  });

  it("does not overwrite a type the source already declared", () => {
    const units = sectionDocument("Places.md", "# Harbour Town\nbody\n");
    units[0].type = "port";
    applyDeclarations(units, [
      { name: "Harbour Town", type: "location", aliases: [], affiliations: [] },
    ]);
    expect(units[0].type).toBe("port");
  });
});
