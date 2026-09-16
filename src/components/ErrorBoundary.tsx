"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // 忽略 hydration 相关的错误
    if (error.message.includes("Hydration")) {
      this.setState({ hasError: false });
    }
  }

  render() {
    return this.props.children;
  }
}
