// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CustomSelect,
  type CustomSelectOption,
} from "../../src/renderer/components/CustomSelect";

const OPTIONS: readonly CustomSelectOption[] = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
  { value: "gamma", label: "Gamma" },
];

function activeOption(trigger: HTMLElement): HTMLElement | null {
  const activeId = trigger.getAttribute("aria-activedescendant");
  return activeId === null ? null : document.getElementById(activeId);
}

describe("CustomSelect", () => {
  it("normalizes the active option when its controlled value changes while open", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <CustomSelect
        label="模型"
        value="alpha"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "模型" });

    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(activeOption(trigger)).toHaveTextContent("Beta");

    rerender(
      <CustomSelect
        label="模型"
        value="gamma"
        options={OPTIONS}
        onChange={onChange}
      />,
    );

    await waitFor(() =>
      expect(activeOption(trigger)).toHaveTextContent("Gamma"),
    );
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("gamma");
  });

  it("normalizes a stale active index after the options shrink", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CustomSelect
        label="模型"
        value="alpha"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "模型" });

    await user.click(trigger);
    await user.keyboard("{End}");
    expect(activeOption(trigger)).toHaveTextContent("Gamma");

    rerender(
      <CustomSelect
        label="模型"
        value="missing"
        options={[{ value: "beta", label: "Beta" }]}
        onChange={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(activeOption(trigger)).toHaveTextContent("Beta"),
    );
  });

  it("never selects an active option that becomes disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <CustomSelect
        label="模型"
        value="alpha"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "模型" });

    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(activeOption(trigger)).toHaveTextContent("Beta");

    rerender(
      <CustomSelect
        label="模型"
        value="alpha"
        options={[
          OPTIONS[0],
          { ...OPTIONS[1], disabled: true },
          OPTIONS[2],
        ]}
        onChange={onChange}
      />,
    );

    await waitFor(() =>
      expect(activeOption(trigger)).toHaveTextContent("Alpha"),
    );
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("alpha");
    expect(onChange).not.toHaveBeenCalledWith("beta");
  });

  it.each([
    ["empty", []],
    [
      "all-disabled",
      [
        { value: "alpha", label: "Alpha", disabled: true },
        { value: "beta", label: "Beta", disabled: true },
      ],
    ],
  ] as const)("disables the trigger for %s options", async (_name, options) => {
    const user = userEvent.setup();
    render(
      <CustomSelect
        label="模型"
        value=""
        options={options}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "模型" });

    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    await user.click(trigger);
    await user.keyboard(" ");
    expect(
      screen.queryByRole("listbox", { name: "模型" }),
    ).not.toBeInTheDocument();
  });

  it("closes and disables an open listbox when all options become disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <CustomSelect
        label="模型"
        value="alpha"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "模型" });
    await user.click(trigger);
    expect(screen.getByRole("listbox", { name: "模型" })).toBeVisible();

    rerender(
      <CustomSelect
        label="模型"
        value="alpha"
        options={OPTIONS.map((option) => ({ ...option, disabled: true }))}
        onChange={onChange}
      />,
    );

    await waitFor(() => expect(trigger).toBeDisabled());
    expect(
      screen.queryByRole("listbox", { name: "模型" }),
    ).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("normalizes the active descendant to the selected option after reordering", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <CustomSelect
        label="模型"
        value="beta"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "模型" });
    await user.click(trigger);
    expect(activeOption(trigger)).toHaveTextContent("Beta");

    rerender(
      <CustomSelect
        label="模型"
        value="beta"
        options={[OPTIONS[2], OPTIONS[0], OPTIONS[1]]}
        onChange={onChange}
      />,
    );

    await waitFor(() =>
      expect(activeOption(trigger)).toHaveTextContent("Beta"),
    );
    expect(trigger).toHaveAttribute(
      "aria-activedescendant",
      expect.stringMatching(/-option-2$/),
    );
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("beta");
  });

  it("closes and disables an open listbox on an explicit disabled transition", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CustomSelect
        label="模型"
        value="alpha"
        options={OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "模型" });
    await user.click(trigger);
    expect(screen.getByRole("listbox", { name: "模型" })).toBeVisible();

    rerender(
      <CustomSelect
        label="模型"
        value="alpha"
        options={OPTIONS}
        disabled
        onChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(trigger).toBeDisabled());
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("aria-activedescendant");
    expect(
      screen.queryByRole("listbox", { name: "模型" }),
    ).not.toBeInTheDocument();
  });
});
