"use client";

import React, { useState } from "react";

interface SubjectPickerProps {
  onSubjectSet: (subject: string) => void;
  isLoading: boolean;
}

export function SubjectPicker({ onSubjectSet, isLoading }: SubjectPickerProps) {
  const [subject, setSubject] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (subject.trim() && !isLoading) {
      onSubjectSet(subject.trim());
    }
  };

  return (
    <div className="card animate-fade-in" style={{ marginBottom: "2rem" }}>
      <h2 className="text-lg font-semibold" style={{ marginBottom: "1rem" }}>
        1. Set the Subject
      </h2>
      <form onSubmit={handleSubmit} className="flex gap-4">
        <input
          type="text"
          className="input flex-1"
          placeholder='e.g., "A golden retriever in a cyberpunk city"'
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={isLoading}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!subject.trim() || isLoading}
        >
          {isLoading ? "Generating..." : "Create Subject"}
        </button>
      </form>
    </div>
  );
}
