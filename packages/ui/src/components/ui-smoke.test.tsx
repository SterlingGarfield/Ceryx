import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, TextArea } from "../index";

describe("ui package smoke tests", () => {
  it("keeps button disabled state", () => {
    render(<Button disabled>Send Prompt</Button>);

    expect(screen.getByRole("button", { name: "Send Prompt" })).toBeDisabled();
  });

  it("connects label and textarea for accessibility", () => {
    render(<TextArea label="Prompt Body" defaultValue="hello" />);

    expect(screen.getByLabelText("Prompt Body")).toBeInTheDocument();
  });
});
