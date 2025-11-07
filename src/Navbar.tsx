import React from "react";

import { Breadcrumb, Layout, Menu, theme } from "antd";

const { Header, Content, Footer } = Layout;

const items = [
  {
    key: 1,
    label: <a href="/">Home</a>,
    href: "/",
  },
  {
    key: 2,
    label: <a href="/no_such_place">404</a>,
  },
];

const App: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  return (
    <Layout>
      <Header style={{ display: "flex", alignItems: "center" }}>
        <div className="demo-logo" />
        <Menu
          theme="dark"
          mode="horizontal"
          defaultSelectedKeys={["1"]}
          items={items}
          style={{ flex: 1, minWidth: 0 }}
        />
      </Header>
      <Content style={{ padding: "0 48px" }}>
        <Breadcrumb
          style={{ margin: "16px 0" }}
          items={[{ title: "Home" }, { title: "Model" }]}
        />
        <div
          style={{
            background: colorBgContainer,
            minHeight: 280,
            padding: 24,
            borderRadius: borderRadiusLG,
          }}
        >
          {children}
        </div>
      </Content>
      <Footer style={{ textAlign: "center" }}>
        Rhizz ©{new Date().getFullYear()}
      </Footer>
    </Layout>
  );
};

export default App;
