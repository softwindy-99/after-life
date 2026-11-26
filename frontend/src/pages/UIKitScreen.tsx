import { useState } from "react";
import { Check, Mail, Plus } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  MultiSelect,
  PageHeader,
  Panel,
  Progress,
  Select,
  Separator,
  Skeleton,
  Spinner,
  Switch,
  Table,
  Tabs,
  Textarea,
} from "../components/ui";

const options = [
  { value: "draft", label: "草稿", description: "发送未启用" },
  { value: "enabled", label: "已启用", description: "自动投递已开启" },
  { value: "unavailable", label: "不可选", disabled: true },
];
const colors = [
  { name: "背景", token: "background" },
  { name: "面板", token: "card" },
  { name: "正文", token: "foreground" },
  { name: "主操作", token: "primary" },
  { name: "焦点 / 选中", token: "accent" },
  { name: "错误 / 删除", token: "destructive" },
];

export function UIKitScreen() {
  const [selected, setSelected] = useState("draft");
  const [multi, setMulti] = useState<string[]>(["draft"]);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState("controls");
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="ui-kit-stack">
      <PageHeader
        eyebrow="AFTER LIFE / DESIGN SYSTEM"
        title="冷光 UI"
        description="复用产品正在使用的组件、状态和动画。这里的示例操作只改变本页状态。"
      />
      <Panel
        title="基础规范"
        description="炭黑底色、明黄主操作、青色焦点与红色警示。提高文字与控件对比，保留安静的阅读区。"
      >
        <div className="ui-kit-colors">
          {colors.map((color) => (
            <div className="ui-kit-color" key={color.token}>
              <span style={{ background: `hsl(var(--${color.token}))` }} />
              <strong>{color.name}</strong>
              <code>--{color.token}</code>
            </div>
          ))}
        </div>
        <Separator />
        <p className="ui-kit-description">
          正文 14px · 辅助文字 12px · 4px 间距基准 · 120 / 180 / 280ms 动画 · 系统字体 ·
          减少动态效果自动生效
        </p>
      </Panel>
      <Tabs
        label="组件分类"
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: "controls",
            label: "控件与表单",
            content: (
              <div className="ui-kit-grid">
                <Panel title="按钮" eyebrow="BUTTON">
                  <div className="ui-kit-demo-row">
                    <Button>
                      <Plus aria-hidden="true" />
                      主操作
                    </Button>
                    <Button variant="secondary">次级操作</Button>
                    <Button variant="outline">边框</Button>
                    <Button variant="ghost">轻操作</Button>
                    <Button variant="destructive">删除</Button>
                    <Button variant="link">文字链接</Button>
                    <Button disabled>禁用</Button>
                    <Button busy>处理中</Button>
                    <Button asChild disabled>
                      <a href="/letters">禁用链接</a>
                    </Button>
                  </div>
                  <Separator />
                  <div className="ui-kit-demo-row">
                    <Button size="sm">小尺寸</Button>
                    <Button size="lg">大尺寸</Button>
                    <Button size="icon" aria-label="新增示例">
                      <Plus aria-hidden="true" />
                    </Button>
                  </div>
                </Panel>
                <Panel title="状态标记" eyebrow="BADGE">
                  <div className="ui-kit-demo-row">
                    <Badge>草稿</Badge>
                    <Badge variant="default">已启用</Badge>
                    <Badge variant="success">已完成</Badge>
                    <Badge variant="warning">待确认</Badge>
                    <Badge variant="destructive">失败</Badge>
                    <Badge variant="outline">轮廓</Badge>
                  </div>
                  <Separator />
                  <Alert>状态含有文字，颜色作为辅助提示。</Alert>
                </Panel>
                <Panel title="表单" eyebrow="FIELD / INPUT">
                  <div className="ui-kit-fields">
                    <Field label="信件标题" hint="描述这封信写给谁。">
                      <Input placeholder="给妈妈的一封信" required />
                    </Field>
                    <Field label="邮箱示例" error="请输入有效的邮箱地址。">
                      <Input type="email" defaultValue="invalid" />
                    </Field>
                    <Field label="禁用输入">
                      <Input disabled defaultValue="暂时不可编辑" />
                    </Field>
                    <Field label="正文">
                      <Textarea placeholder="从一句想说的话开始……" />
                    </Field>
                    <Switch
                      label="启用示例通知"
                      description="开关只用于演示，不会改变真实设置。"
                      checked={checked}
                      onChange={(event) => setChecked(event.target.checked)}
                    />
                  </div>
                </Panel>
                <Panel title="选择器" eyebrow="SELECT">
                  <div className="ui-kit-fields">
                    <Field label="单选状态">
                      <Select
                        ariaLabel="单选状态"
                        options={options}
                        value={selected}
                        onValueChange={setSelected}
                      />
                    </Field>
                    <Field label="多选状态">
                      <MultiSelect
                        ariaLabel="多选状态"
                        options={options}
                        value={multi}
                        onValueChange={setMulti}
                      />
                    </Field>
                    <Select
                      ariaLabel="禁用选择器"
                      options={options}
                      value="draft"
                      onValueChange={() => undefined}
                      disabled
                    />
                  </div>
                </Panel>
              </div>
            ),
          },
          {
            value: "feedback",
            label: "反馈与动画",
            content: (
              <div className="ui-kit-grid">
                <Panel title="模态与确认" eyebrow="DIALOG">
                  <div className="ui-kit-demo-row">
                    <Button onClick={() => setDialog(true)}>打开弹窗</Button>
                    <Button variant="destructive" onClick={() => setConfirm(true)}>
                      打开确认框
                    </Button>
                  </div>
                  <Separator />
                  <p className="ui-kit-description">
                    弹窗隔离背景，约束焦点，支持 Escape 关闭，关闭后回到触发控件。忙碌状态禁止关闭。
                  </p>
                </Panel>
                <Panel title="加载与进度" eyebrow="PROGRESS">
                  <div className="ui-kit-fields">
                    <Progress label="示例进度" value={64} />
                    <div className="ui-kit-demo-row">
                      <Button variant="outline" onClick={() => setBusy((value) => !value)}>
                        {busy ? "停止加载演示" : "开始加载演示"}
                      </Button>
                      {busy && <Spinner label="示例正在加载" />}
                    </div>
                    {busy && <Progress label="不定进度演示" />}
                    <div className="ui-kit-skeleton">
                      <Skeleton />
                      <Skeleton style={{ width: "70%" }} />
                      <Skeleton style={{ width: "45%" }} />
                    </div>
                  </div>
                </Panel>
                <Panel title="空状态" eyebrow="EMPTY STATE">
                  <EmptyState
                    title="还没有信件"
                    description="创建一封草稿，开始整理想留下的话。"
                    icon={<Mail />}
                    action={<Button variant="outline">示例操作</Button>}
                  />
                </Panel>
                <Card>
                  <CardHeader>
                    <CardTitle>组合卡片</CardTitle>
                    <CardDescription>同一套颜色、边框和间距，支持自由组合。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="success">
                      <Check aria-hidden="true" size={14} />
                      已就绪
                    </Badge>
                    <p className="ui-kit-description">
                      页面进入、弹窗进入、抽屉和状态反馈使用共享动画令牌。减少动态效果时全部关闭。
                    </p>
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            value: "data",
            label: "数据与布局",
            content: (
              <Panel
                title="语义表格"
                eyebrow="TABLE"
                description="使用真实 table 语义，在窄屏中由带名称的滚动区容纳表格。"
              >
                <Table scrollLabel="组件示例信件列表">
                  <thead>
                    <tr>
                      <th scope="col">信件</th>
                      <th scope="col">状态</th>
                      <th scope="col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>给妈妈的一封信</td>
                      <td>
                        <Badge>草稿</Badge>
                      </td>
                      <td>
                        <Button size="sm" variant="outline">
                          编辑
                        </Button>
                      </td>
                    </tr>
                    <tr>
                      <td>给未来的自己</td>
                      <td>
                        <Badge variant="default">已启用</Badge>
                      </td>
                      <td>
                        <Button size="sm" variant="outline">
                          编辑
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </Table>
              </Panel>
            ),
          },
        ]}
      />
      <Dialog
        open={dialog}
        title="编辑示例"
        description="这是组件演示，不会保存业务数据。"
        onOpenChange={setDialog}
      >
        <div className="dialog-body">
          <Field label="示例名称">
            <Input placeholder="试试键盘 Tab 和 Escape" />
          </Field>
        </div>
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setDialog(false)}>
            取消
          </Button>
          <Button onClick={() => setDialog(false)}>完成示例</Button>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        title="确认示例操作？"
        description="此按钮只关闭示例弹窗，不会删除真实数据。"
        confirmLabel="确认示例"
        onOpenChange={setConfirm}
        onConfirm={() => setConfirm(false)}
      />
    </div>
  );
}
