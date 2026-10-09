import { ChevronDown, CircleDot, Gauge, Layers3, Palette, Printer, Ruler, Scissors, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

import { groupStageRolls, stageOperationSpecs, stageRollWeight } from "../../lib/stage-operation-specs";

import type { ProductionOrderRecord, ProductionRollRecord } from "../../../../shared/production";

type Props = {
  stage: "printing" | "cutting";
  orders: ProductionOrderRecord[];
  rolls: ProductionRollRecord[];
  language: string;
  canOperate: boolean;
  saving: boolean;
  selectedMachine: string;
  weights: Record<number, string>;
  text: (key: string) => string;
  number: (value: string | number | null | undefined, digits?: number) => string;
  productName: (order: ProductionOrderRecord) => string;
  creatorName: (roll: ProductionRollRecord) => string;
  date: (value: string | null) => string;
  onWeight: (id: number, value: string) => void;
  onRecord: (roll: ProductionRollRecord) => void;
};

const specIcons = {
  size: Ruler,
  cylinder: Gauge,
  plateDrawer: Layers3,
  frontColors: Palette,
  backColors: Layers3,
  cutLength: Ruler,
  punching: CircleDot,
  material: Layers3,
};

export default function RollOperatorOrders(props: Props) {
  const {
    stage, orders, rolls, language, canOperate, saving, selectedMachine, weights, text,
    number, productName, creatorName, date, onWeight, onRecord,
  } = props;
  const [search, setSearch] = useState("");
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);
  const groups = useMemo(
    () => groupStageRolls(orders, rolls, language, search, text("unrecorded")),
    [orders, rolls, language, search, text],
  );

  const visibleOpenId = groups.some(group => group.orderId === openOrderId) ? openOrderId : null;

  const searchLabel = language === "en"
    ? "Search customer, order, production order or roll number"
    : "البحث باسم العميل أو رقم الطلب أو أمر الإنتاج أو الرول";
  const availableLabel = stage === "printing"
    ? (language === "en" ? "Available for printing" : "المتاح للطباعة")
    : (language === "en" ? "Available for cutting" : "المتاح للقص");
  const quantityLabel = language === "en" ? "Quantity (kg)" : "الكمية (كجم)";
  const noMatches = language === "en" ? "No matching rolls or orders" : "لا توجد رولات أو أوامر مطابقة";

  return <section className="film-operator roll-operator" data-operator-stage={stage} aria-label={text(stage)}>
    <label className="film-search">
      <Search aria-hidden="true" />
      <span className="sr-only">{searchLabel}</span>
      <input
        type="search"
        value={search}
        onChange={event => setSearch(event.target.value)}
        data-operator-search
        aria-label={searchLabel}
        placeholder={language === "en" ? "Customer, order, production no. or roll" : "العميل أو الطلب أو أمر الإنتاج أو الرول"}
      />
    </label>
    {groups.length ? <div className="film-order-groups">
      {groups.map(group => {
        const expanded = visibleOpenId === group.orderId;
        const buttonId = `${stage}-order-toggle-${group.orderId}`;
        const panelId = `${stage}-order-panel-${group.orderId}`;
        return <section className="film-order-group" key={group.orderId}>
          <button
            id={buttonId}
            type="button"
            className="film-order-disclosure"
            data-operator-order-id={group.orderId}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setOpenOrderId(expanded ? null : group.orderId)}
          >
            <span className="film-group-customer">
              <strong className="prod-number">{group.orderNumber}</strong>
              <span>{group.customerName}</span>
            </span>
            <span className="film-group-count">
              {number(group.members.length, 0)} <span>{text("ordersUnit")}</span>
            </span>
            <ChevronDown aria-hidden="true" className={expanded ? "is-open" : ""} />
          </button>
          <div className="film-group-content" id={panelId} role="region" aria-labelledby={buttonId} hidden={!expanded}>
            {expanded && group.members.map(member => {
              const representative = member.rolls[0];
              const identityOrder = representative
                ? { ...member.order, product: representative.product }
                : member.order;
               const stageProduct = representative?.product
                 ? { ...representative.product, plate_drawer_code: representative.product.plate_drawer_code === undefined
                   ? member.order.product?.plate_drawer_code : representative.product.plate_drawer_code }
                 : member.order.product;
               const specs = stageOperationSpecs(stage, stageProduct, language, text("unrecorded"));
              const available = stageRollWeight(member.rolls);
              return <article
                className="film-production-order roll-operator-production-order"
                key={member.order.id}
                data-production-order-id={member.order.id}
              >
                <header className="film-order-identity">
                  <div>
                    <h3 className="prod-number">{member.order.production_order_number}</h3>
                    <p>{productName(identityOrder)}</p>
                  </div>
                </header>
                <div className="film-spec-grid">
                  {specs.map(spec => {
                    const Icon = specIcons[spec.key as keyof typeof specIcons] ?? Gauge;
                    return <div className="film-spec" key={spec.key}>
                      <Icon aria-hidden="true" />
                      <span>{spec.label}</span>
                      <strong><bdi dir="auto">{spec.value}</bdi></strong>
                    </div>;
                  })}
                </div>
                <div className="film-order-metrics">
                  <div><span>{quantityLabel}</span><strong><bdi dir="ltr">{number(member.order.final_quantity_kg)} kg</bdi></strong></div>
                  <div><span>{availableLabel}</span><strong><bdi dir="ltr">{available === null ? "—" : `${number(available)} kg`}</bdi></strong></div>
                  <div><span>{text("rolls")}</span><strong>{number(member.rolls.length, 0)}</strong></div>
                </div>
                <div className="roll-operator-rolls">
                  {member.rolls.map(roll => <article
                    className="roll-operator-roll"
                    key={roll.id}
                    data-production-roll-id={roll.id}
                  >
                    <div className="roll-operator-roll-head">
                      <Link className="roll-operator-roll-link prod-number" href={`/production/rolls/${roll.id}`}>
                        {roll.roll_number}
                      </Link>
                      <strong className="roll-operator-roll-weight"><bdi dir="ltr">{number(roll.weight_kg)} kg</bdi></strong>
                    </div>
                    <div className="roll-operator-roll-context">
                      <div data-roll-author><span>{language === "en" ? "By" : "بواسطة"}</span><strong>{creatorName(roll)}</strong></div>
                      <div data-roll-date><span>{language === "en" ? "Date" : "التاريخ"}</span><strong>{date(roll.created_at)}</strong></div>
                    </div>
                    {stage === "cutting" && <div className="prod-field roll-operator-net-field">
                      <label htmlFor={`net-${roll.id}`}>{text("netWeight")}</label>
                      <input
                        id={`net-${roll.id}`}
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        max={roll.weight_kg}
                        step="0.01"
                        value={weights[roll.id] ?? ""}
                        disabled={!canOperate}
                        onChange={event => onWeight(roll.id, event.target.value)}
                      />
                    </div>}
                    <button
                      type="button"
                      className="prod-btn roll-operator-action"
                      disabled={!canOperate || saving || !selectedMachine}
                      onClick={() => onRecord(roll)}
                    >
                      {stage === "printing" ? <Printer aria-hidden="true" /> : <Scissors aria-hidden="true" />}
                      {text(stage === "printing" ? "printRoll" : "cutRoll")}
                    </button>
                  </article>)}
                </div>
              </article>;
            })}
          </div>
        </section>;
      })}
    </div> : <div className="prod-empty film-no-results">
      <strong>{search ? noMatches : text("noEligible")}</strong>
      {search && <span>{language === "en" ? "Try a customer, order or roll number." : "جرّب البحث باسم العميل أو رقم الطلب أو الرول."}</span>}
    </div>}
  </section>;
}
